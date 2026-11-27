#!/usr/bin/env bash
# Cập nhật: git pull -> backup -> build -> migrate -> up -d -> kiểm tra health -> rollback ảnh nếu health hỏng.
# Lưu ý: rollback chỉ trả ảnh ứng dụng; migration DB là một chiều (muốn lùi DB: ./scripts/restore.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Thiếu .env (xem docs/DEPLOY.md)" >&2; exit 1; }
if [ "${SKIP_PULL:-0}" = 1 ] || [ ! -d .git ]; then echo "(bỏ qua git pull)"; else git pull --ff-only; fi

./scripts/backup.sh || echo "CẢNH BÁO: backup thất bại/không chạy (backup container chưa lên?)" >&2

# Giữ ảnh hiện tại làm điểm quay lui
for img in portal-app portal-migrate; do
  if docker image inspect "$img:latest" >/dev/null 2>&1; then docker tag "$img:latest" "$img:rollback"; fi
done

docker compose build
docker compose run --rm migrate          # prisma migrate deploy + seed idempotent
docker compose up -d --remove-orphans

healthy() {
  for _ in $(seq 1 30); do
    s="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q portal)" 2>/dev/null || true)"
    [ "$s" = healthy ] && return 0
    sleep 3
  done
  return 1
}

if healthy; then
  echo "Cập nhật xong, portal healthy."
  exit 0
fi

echo "Health FAIL -> rollback ảnh portal-app:rollback" >&2
if docker image inspect portal-app:rollback >/dev/null 2>&1; then
  docker tag portal-app:rollback portal-app:latest
  docker compose up -d --no-build --no-deps portal
  healthy && echo "Đã rollback, portal healthy." || echo "Rollback xong nhưng vẫn không healthy: xem docker compose logs portal" >&2
else
  echo "Không có ảnh cũ để quay lui (lần triển khai đầu)." >&2
fi
exit 1
