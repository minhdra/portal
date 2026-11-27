# Triển khai portal bằng Docker

Kiến trúc: `gateway` (nginx, chỉ `127.0.0.1:${GATEWAY_PORT:-18790}`) → `portal` (Next.js standalone, cổng 3100, không publish) ↔ `postgres` (16, không publish). `migrate` chạy một lần trước portal. `backup` sao lưu hằng ngày. Mạng `portal` là mạng nội bộ (không ra Internet), mạng `edge` chỉ của gateway.

Yêu cầu: Docker + Compose v2. Không cần sudo (user thuộc nhóm `docker`).

## 1. Tạo `.env`

```bash
cp .env.example .env && chmod 600 .env
# sinh bí mật (hex, an toàn để nhúng vào URL):
openssl rand -hex 24    # -> POSTGRES_PASSWORD
openssl rand -hex 48    # -> SESSION_SECRET
```

Sửa `.env`:

- `POSTGRES_PASSWORD`, `SESSION_SECRET`: dán giá trị vừa sinh.
- `ADMIN_USER`, `ADMIN_INITIAL_PASSWORD`: tự đặt bằng tay (>= 8 ký tự, không để `CHANGE_ME`). Chỉ dùng khi seed lần đầu; admin bị bắt đổi mật khẩu ở lần đăng nhập đầu. Seed chạy lại không ghi đè mật khẩu đã đổi.
- `DATABASE_URL` trong `.env` bị compose ghi đè bằng `postgresql://portal:${POSTGRES_PASSWORD}@postgres:5432/portal` (không cần giữ khớp tay).
- Tuỳ chọn: `GATEWAY_PORT` (mặc định 18790), `BACKUP_DIR` (mặc định `./backups`, thư mục phải ghi được bởi `BACKUP_UID:BACKUP_GID`, mặc định 1000:1000; nếu user host khác thì đặt `BACKUP_UID=$(id -u)` `BACKUP_GID=$(id -g)`), `BACKUP_KEEP` (14), `BACKUP_HOUR` (giờ UTC, mặc định 3).
- `TRUST_PROXY=1`, `CLIENT_IP_HEADER=x-client-ip`, `NODE_ENV=production` đã đặt cứng trong compose: IP khách do gateway ghi đè vào `X-Client-IP`.

Không commit `.env`. `SESSION_SECRET` phải >= 32 ký tự (dùng ký cookie thiết bị quen; production in cảnh báo khi thiếu). Compose đã đặt `UV_THREADPOOL_SIZE=8`.

**Nâng cấp từ DB đã có dữ liệu:** chạy trước migration `docker compose exec -T postgres psql -U portal -d portal < scripts/db/check-dup-files.sql` (chỉ đọc) để xem có file trùng sha256 trong cùng item không; migration `security_hardening` xoá hàng trùng nhưng blob trên đĩa sẽ mồ côi.

## 2. Khởi động

```bash
docker compose build
docker compose up -d     # postgres -> migrate (migrate deploy + seed) -> portal -> gateway
docker compose ps        # postgres, portal, gateway: healthy; migrate: Exited (0)
```

## 3. Kiểm tra

```bash
curl -s http://127.0.0.1:${GATEWAY_PORT:-18790}/api/health        # {"ok":true}
docker compose logs migrate | tail -5
docker compose exec portal id                                      # uid=1000(node)
```

`/api/health` chỉ mở cho kiểm tra nội bộ: request từ Internet qua tunnel có `CF-Connecting-IP` công cộng nên gateway trả 403 (không để lộ trạng thái DB). Đăng nhập thử: `http://127.0.0.1:18790/` (cookie `__Host-portal_session` là Secure nên trình duyệt chỉ giữ qua https, tức qua tunnel; thử bằng curl thì dùng `-H 'X-Forwarded-Proto: https'` và `-c/-b` cookie jar).

## 4. Backup / restore

Sidecar `backup` chạy hằng ngày: `pg_dump -Fc` + tar `uploads`, kiểm tra `pg_restore --list` và `tar -t`, giữ `BACKUP_KEEP` bản mới nhất mỗi loại trong `${BACKUP_DIR}/db` và `${BACKUP_DIR}/uploads`.

```bash
./scripts/backup.sh                    # chạy ngay một lần
./scripts/restore.sh --dry-run         # kiểm tra bản mới nhất, không đổi gì
./scripts/restore.sh                   # hỏi xác nhận; dừng portal+gateway, GHI ĐÈ DB và uploads, bật lại
./scripts/restore.sh --db FILE --uploads FILE --yes
```

Nên chép `BACKUP_DIR` ra máy/ổ khác (cùng máy chưa phải backup thật).

## 5. Cập nhật

```bash
./scripts/cap-nhat.sh                  # git pull --ff-only, backup, build, migrate, up -d, chờ healthy
SKIP_PULL=1 ./scripts/cap-nhat.sh      # không pull
```

Nếu portal không healthy sau cập nhật, script trả ảnh `portal-app:rollback` (ảnh trước đó) và thoát mã 1. Rollback chỉ lùi ứng dụng; migration DB là một chiều. Muốn lùi cả DB: `./scripts/restore.sh` (bản backup do script vừa tạo trước khi build).

## 6. Thêm tool phía sau gateway

Đặt file `*.conf` (các khối `location`) vào `nginx/conf.d/tools/`, rồi `docker compose exec gateway nginx -t && docker compose exec gateway nginx -s reload`. Mẫu `auto-pull-nas.conf.example` (`/auto-pull-nas/` → `host.docker.internal:18780`): tắt mặc định vì frontend auto-pull-nas hiện chưa có base path `/auto-pull-nas/`; chỉ bật sau khi PR base path của repo đó được merge và deploy.

## 7. Chuyển tunnel Cloudflare sang gateway (CHỈ MÔ TẢ, chưa thực hiện; cần chủ dự án đồng ý)

Hiện trạng (đọc bằng `docker inspect apn-tunnel`, đã bỏ phần bí mật): container `apn-tunnel`, ảnh `cloudflare/cloudflared:2024.12.2`, `network_mode: host`, restart `unless-stopped`, entrypoint `cloudflared --no-autoupdate`, lệnh `tunnel --no-autoupdate --url http://127.0.0.1:18780`, môi trường chỉ có PATH/SSL_CERT_FILE, không có token. Nghĩa là đây là quick tunnel (`*.trycloudflare.com`, không đăng nhập, không có tên miền cố định). SPEC nói tunnel `xldl-hye.tumiki.org`; cấu hình hiện tại KHÔNG phải tunnel có tên đó. Mỗi lần tạo lại container quick tunnel, URL đổi.

Phương án A (giữ quick tunnel, đổi đích): tạo lại `apn-tunnel` với `--url http://127.0.0.1:18790` thay vì 18780. URL công khai SẼ ĐỔI. Các bước:

1. Gateway đã chạy và `curl http://127.0.0.1:18790/` trả 200; đã bật khối `/auto-pull-nas/` (mục 6) nếu muốn giữ truy cập auto-pull-nas qua cùng domain.
2. Ghi lại cấu hình cũ: `docker inspect apn-tunnel > tunnel-cu.json` (không commit; chứa env).
3. `docker rm -f apn-tunnel` rồi `docker run -d --name apn-tunnel --network host --restart unless-stopped cloudflare/cloudflared:2024.12.2 tunnel --no-autoupdate --url http://127.0.0.1:18790`; lấy URL mới từ `docker logs apn-tunnel`.

Phương án B (tên miền cố định `xldl-hye.tumiki.org`): dùng named tunnel: ingress `xldl-hye.tumiki.org` → `http://127.0.0.1:18790`, chạy `cloudflared tunnel run --token <TOKEN>` (token lấy từ dashboard Cloudflare Zero Trust, đặt trong biến môi trường, không ghi vào repo/log). Cần chủ dự án có quyền tên miền.

Quay lui: `docker rm -f apn-tunnel` rồi chạy lại lệnh gốc với `--url http://127.0.0.1:18780` (cùng ảnh, `--network host`, `--restart unless-stopped`). Auto-pull-nas không bị ảnh hưởng vì cổng 18780 vẫn publish trên host. Phương án A quay lui không lấy lại được URL cũ (quick tunnel cấp URL ngẫu nhiên mới).

Sau khi chuyển: gateway tin `CF-Connecting-IP` chỉ từ dải mạng docker/loopback; cổng gateway bind `127.0.0.1` nên người ngoài không giả được header này.

## 8. Dọn dẹp / gỡ

```bash
docker compose down          # giữ dữ liệu
docker compose down -v       # XOÁ volume pgdata và uploads (mất dữ liệu)
```
