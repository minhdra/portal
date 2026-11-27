#!/usr/bin/env bash
# Khôi phục từ BACKUP_DIR. Mặc định dùng bản mới nhất. Chạy trên host, không sudo.
#   ./scripts/restore.sh --dry-run                 # chỉ kiểm tra, không đổi gì
#   ./scripts/restore.sh [--db FILE] [--uploads FILE] [--yes] [--skip-backup]
# Hành động thật (theo thứ tự, lỗi ở bước nào thì DB/uploads cũ vẫn còn nguyên và portal+gateway được bật lại):
#   1. backup hiện tại (bỏ qua bằng --skip-backup)   2. dừng portal+gateway
#   3. giải nén uploads vào thư mục tạm TRONG volume (chưa xoá gì)
#   4. pg_restore --clean --single-transaction --exit-on-error (một giao dịch: lỗi => rollback, DB cũ còn)
#   5. thay uploads (đổi chỗ thư mục tạm)   6. bật lại.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0 YES=0 SKIPBK=0 DB="" UP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --yes) YES=1 ;;
    --skip-backup) SKIPBK=1 ;;
    --db) DB="${2:?--db cần đường dẫn}"; shift ;;
    --uploads) UP="${2:?--uploads cần đường dẫn}"; shift ;;
    *) echo "Tham số lạ: $1" >&2; exit 2 ;;
  esac
  shift
done

# Không `source .env` (có thể chứa $(...) hay ký tự đặc biệt): chỉ đọc đúng các khoá cần, như văn bản.
envget() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/[[:space:]]*#.*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" || true
}
BDIR="${BACKUP_DIR:-$(envget BACKUP_DIR)}"; BDIR="${BDIR:-./backups}"
PROJ="${COMPOSE_PROJECT_NAME:-$(envget COMPOSE_PROJECT_NAME)}"; PROJ="${PROJ:-portal}"
BUID="${BACKUP_UID:-$(envget BACKUP_UID)}"; BGID="${BACKUP_GID:-$(envget BACKUP_GID)}"
UID_="${BUID:-1000}:${BGID:-1000}"

[ -n "$DB" ] || DB="$(ls -1 "$BDIR"/db/portal-*.dump 2>/dev/null | sort | tail -n1 || true)"
[ -n "$UP" ] || UP="$(ls -1 "$BDIR"/uploads/uploads-*.tar.gz 2>/dev/null | sort | tail -n1 || true)"
[ -n "$DB" ] && [ -f "$DB" ] || { echo "Không thấy bản dump DB trong $BDIR/db" >&2; exit 1; }
[ -n "$UP" ] && [ -f "$UP" ] || { echo "Không thấy bản uploads trong $BDIR/uploads" >&2; exit 1; }
DB="$(cd "$(dirname "$DB")" && pwd)/$(basename "$DB")"
UP="$(cd "$(dirname "$UP")" && pwd)/$(basename "$UP")"

# Ảnh postgres đúng như compose (đã ghim phiên bản)
IMG="$(docker compose config --images | grep -m1 postgres || true)"
[ -n "$IMG" ] || { echo "Không xác định được ảnh postgres từ docker compose config" >&2; exit 1; }
echo "DB      : $DB"
echo "Uploads : $UP"
list="$(docker run --rm --user "$UID_" -v "$DB:/in.dump:ro" "$IMG" pg_restore --list /in.dump)" \
  || { echo "Dump không đọc được (pg_restore --list lỗi)" >&2; exit 1; }
tocn="$(printf '%s\n' "$list" | grep -c ' TABLE DATA ' || true)"
tarlist="$(tar -tzf "$UP")" || { echo "Tar uploads không đọc được" >&2; exit 1; }
nfiles="$(printf '%s\n' "$tarlist" | grep -vc '/$' || true)"
echo "Kiểm tra: dump đọc được, $tocn bảng dữ liệu; tar đọc được, $nfiles tệp."
[ "$tocn" -ge 1 ] || { echo "Dump không hợp lệ" >&2; exit 1; }

if [ "$DRY" = 1 ]; then
  echo "[dry-run] Sẽ: $([ "$SKIPBK" = 1 ] && echo 'KHÔNG backup hiện tại; ' || echo 'backup hiện tại; ')dừng portal+gateway; giải nén uploads vào thư mục tạm trong volume ${PROJ}_uploads; pg_restore --clean --if-exists --single-transaction --exit-on-error vào DB portal; đổi chỗ uploads; bật lại. Không thay đổi gì."
  exit 0
fi
if [ "$YES" != 1 ]; then
  printf 'Sẽ GHI ĐÈ database và uploads hiện tại. Gõ "restore" để tiếp tục: '
  read -r a; [ "$a" = restore ] || { echo "Huỷ."; exit 1; }
fi

if [ "$SKIPBK" = 1 ]; then
  echo "CẢNH BÁO: --skip-backup, không sao lưu trạng thái hiện tại." >&2
else
  echo "Sao lưu trạng thái hiện tại trước khi ghi đè..."
  ./scripts/backup.sh || { echo "Backup hiện tại thất bại: dừng, chưa đổi gì (chạy lại với --skip-backup nếu chấp nhận mất trạng thái hiện tại)." >&2; exit 1; }
fi

OK=0
cleanup() {
  if [ "$OK" != 1 ]; then
    echo "LỖI trong lúc khôi phục: DB/uploads hiện tại giữ nguyên (xem bước báo lỗi phía trên). Bật lại portal+gateway..." >&2
    # volume tạm có thể còn sót: xoá (không đụng dữ liệu thật)
    docker run --rm --user 1000:1000 -v "${PROJ}_uploads:/data/uploads" "$IMG" sh -c 'rm -rf /data/uploads/.restore-tmp' >/dev/null 2>&1 || true
    docker compose up -d --no-deps portal gateway || echo "Bật lại thất bại: chạy 'docker compose up -d'" >&2
  fi
}
trap cleanup EXIT

docker compose stop gateway portal
docker compose up -d --wait postgres backup
# uid 1000 = user node của portal (chủ volume); tar đưa qua stdin vì file backup mode 0600 của uid khác.
# Bước 3: giải nén vào thư mục tạm cùng volume (cùng filesystem => đổi chỗ bằng mv nhanh); chưa xoá gì.
docker run --rm -i --user 1000:1000 -v "${PROJ}_uploads:/data/uploads" "$IMG" \
  sh -c 'set -e; rm -rf /data/uploads/.restore-tmp; mkdir /data/uploads/.restore-tmp; tar -C /data/uploads/.restore-tmp -xzf -' < "$UP"
# Bước 4: pg_restore chạy trong container backup; PGPASSWORD nằm sẵn trong env container, không lộ ra lệnh/log.
docker compose exec -T backup pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -d portal < "$DB"
# Bước 5: DB đã xong => thay uploads (xoá cũ rồi mv từng mục từ thư mục tạm lên).
docker run --rm --user 1000:1000 -v "${PROJ}_uploads:/data/uploads" "$IMG" sh -c '
  set -e; cd /data/uploads
  find . -mindepth 1 -maxdepth 1 ! -name .restore-tmp -exec rm -rf {} +
  find .restore-tmp -mindepth 1 -maxdepth 1 -exec mv {} . \;
  rmdir .restore-tmp'
OK=1
docker compose up -d
echo "Khôi phục xong. Kiểm tra: docker compose ps"
