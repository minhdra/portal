#!/bin/sh
# Sao lưu Postgres (pg_dump -Fc) + tar uploads, xoay vòng BACKUP_KEEP bản.
#  - Trong container backup (IN_BACKUP_CONTAINER=1): chạy trực tiếp; --loop = chạy hằng ngày lúc BACKUP_HOUR (giờ container, UTC).
#  - Trên host: ./scripts/backup.sh  -> chạy một lần qua `docker compose exec backup`.
# Không in mật khẩu: PGPASSWORD chỉ nằm trong môi trường container.
set -eu

if [ "${IN_BACKUP_CONTAINER:-}" != "1" ]; then
  cd "$(dirname "$0")/.."
  exec docker compose exec -T backup /bin/sh /scripts/backup.sh "$@"
fi

DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-14}"
case "$KEEP" in ''|*[!0-9]*) echo "LỖI: BACKUP_KEEP phải là số nguyên >= 1 (đang: '$KEEP')" >&2; exit 1 ;; esac
[ "$KEEP" -ge 1 ] || { echo "LỖI: BACKUP_KEEP phải >= 1 (0 sẽ xoá hết bản sao lưu)" >&2; exit 1; }
UPLOADS="${UPLOAD_DIR:-/data/uploads}"

run_once() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$DIR/db" "$DIR/uploads"
  umask 077
  dump="$DIR/db/portal-$ts.dump"
  tarf="$DIR/uploads/uploads-$ts.tar.gz"
  trap 'rm -f "$dump.tmp" "$tarf.tmp"' EXIT

  # Trong chế độ --loop hàm chạy trong `run_once || ...` nên set -e KHÔNG có hiệu lực: mỗi bước phải tự `|| return 1`.
  pg_dump -Fc --no-owner -f "$dump.tmp" || return 1
  # Kiểm tra khôi phục được: pg_restore đọc được mục lục và có bảng dữ liệu.
  n="$(pg_restore --list "$dump.tmp" | grep -c ' TABLE DATA ' || true)"
  if [ "$n" -lt 1 ]; then echo "LỖI: dump không có mục TABLE DATA" >&2; return 1; fi
  mv "$dump.tmp" "$dump" || return 1

  tar -C "$UPLOADS" -czf "$tarf.tmp" . || return 1
  tar -tzf "$tarf.tmp" >/dev/null || return 1   # kiểm tra đọc được
  mv "$tarf.tmp" "$tarf" || return 1
  trap - EXIT

  # Xoay vòng: giữ KEEP bản mới nhất mỗi loại.
  for d in db uploads; do
    ls -1 "$DIR/$d" | grep -v "\.tmp$" | sort -r | tail -n +"$((KEEP + 1))" | while read -r f; do rm -f "$DIR/$d/$f"; done
  done
  echo "[$(date -u +%FT%TZ)] backup ok: $(basename "$dump") ($n bảng), $(basename "$tarf")"
}

if [ "${1:-}" = "--loop" ]; then
  H="${BACKUP_HOUR:-3}"
  while true; do
    now="$(( $(date +%-H) * 3600 + $(date +%-M) * 60 + $(date +%-S) ))"
    target="$(( H * 3600 ))"
    wait=$(( target - now ))
    [ "$wait" -le 0 ] && wait=$(( wait + 86400 ))
    echo "[$(date -u +%FT%TZ)] backup kế tiếp sau ${wait}s"
    sleep "$wait"
    run_once || echo "backup THẤT BẠI" >&2
    sleep 60
  done
else
  run_once
fi
