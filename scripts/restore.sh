#!/usr/bin/env bash
# Khôi phục từ BACKUP_DIR. Mặc định dùng bản mới nhất. Chạy trên host, không sudo.
#   ./scripts/restore.sh --dry-run                 # chỉ kiểm tra, không đổi gì
#   ./scripts/restore.sh [--db FILE] [--uploads FILE] [--yes]
# Hành động thật: dừng portal+gateway, GHI ĐÈ database `portal` (pg_restore --clean) và thay toàn bộ uploads, rồi bật lại.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0 YES=0 DB="" UP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --yes) YES=1 ;;
    --db) DB="$2"; shift ;;
    --uploads) UP="$2"; shift ;;
    *) echo "Tham số lạ: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -f .env ]; then set -a; . ./.env; set +a; fi   # chỉ lấy BACKUP_DIR, không in giá trị
BDIR="${BACKUP_DIR:-./backups}"
PROJ="${COMPOSE_PROJECT_NAME:-portal}"
UID_="${BACKUP_UID:-1000}:${BACKUP_GID:-1000}"
[ -n "$DB" ] || DB="$(ls -1 "$BDIR"/db/portal-*.dump 2>/dev/null | sort | tail -n1 || true)"
[ -n "$UP" ] || UP="$(ls -1 "$BDIR"/uploads/uploads-*.tar.gz 2>/dev/null | sort | tail -n1 || true)"
[ -n "$DB" ] && [ -f "$DB" ] || { echo "Không thấy bản dump DB trong $BDIR/db" >&2; exit 1; }
[ -n "$UP" ] && [ -f "$UP" ] || { echo "Không thấy bản uploads trong $BDIR/uploads" >&2; exit 1; }
DB="$(cd "$(dirname "$DB")" && pwd)/$(basename "$DB")"
UP="$(cd "$(dirname "$UP")" && pwd)/$(basename "$UP")"

IMG=postgres:16-alpine
echo "DB      : $DB"
echo "Uploads : $UP"
tocn="$(docker run --rm --user "$UID_" -v "$DB:/in.dump:ro" "$IMG" pg_restore --list /in.dump | grep -c ' TABLE DATA ' || true)"
nfiles="$(tar -tzf "$UP" | grep -vc '/$' || true)"
echo "Kiểm tra: dump đọc được, $tocn bảng dữ liệu; tar đọc được, $nfiles tệp."
[ "$tocn" -ge 1 ] || { echo "Dump không hợp lệ" >&2; exit 1; }

if [ "$DRY" = 1 ]; then
  echo "[dry-run] Sẽ: dừng portal+gateway; pg_restore --clean --if-exists vào DB portal; xoá và giải nén lại volume ${PROJ}_uploads; bật lại. Không thay đổi gì."
  exit 0
fi
if [ "$YES" != 1 ]; then
  printf 'Sẽ GHI ĐÈ database và uploads hiện tại. Gõ "restore" để tiếp tục: '
  read -r a; [ "$a" = restore ] || { echo "Huỷ."; exit 1; }
fi

docker compose stop gateway portal
docker compose up -d postgres
# pg_restore chạy trong container backup (có PGPASSWORD trong env, không lộ ra lệnh/log).
docker compose exec -T backup pg_restore --clean --if-exists --no-owner -d portal < "$DB"
# uid 1000 = user node của portal (chủ volume); tar đưa qua stdin vì file backup mode 0600 của uid khác
docker run --rm -i --user 1000:1000 -v "${PROJ}_uploads:/data/uploads" "$IMG" \
  sh -c 'find /data/uploads -mindepth 1 -delete && tar -C /data/uploads -xzf -' < "$UP"
docker compose up -d
echo "Khôi phục xong. Kiểm tra: docker compose ps"
