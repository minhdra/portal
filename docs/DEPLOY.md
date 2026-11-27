# Triển khai portal bằng Docker

Kiến trúc: `gateway` (nginx, chỉ `127.0.0.1:${GATEWAY_PORT:-18790}`) → `portal` (Next.js standalone, cổng 3100, không publish) ↔ `postgres` (16, không publish). `migrate` chạy một lần trước portal. `backup` sao lưu hằng ngày. Mạng `portal` là mạng nội bộ (không ra Internet), mạng `edge` chỉ của gateway, subnet ghim `10.213.77.0/24` (gateway `10.213.77.1`; nếu trùng dải khác trên máy thì đổi cùng lúc trong `docker-compose.yml` và `set_real_ip_from`/`allow` trong `nginx/portal.conf`). Mọi service có `init: true` và log json-file xoay vòng (10 MB x 3). Tên ảnh theo `${COMPOSE_PROJECT_NAME:-portal}-app|-migrate`.

**Quy tắc an ninh:** gateway chỉ tin `CF-Connecting-IP` từ `10.213.77.1` (nơi kết nối từ host/cloudflared đi vào). TUYỆT ĐỐI không publish cổng gateway ra ngoài `127.0.0.1` (kể cả `0.0.0.0` hay IP LAN): khi đó mọi kết nối từ ngoài cũng trông như từ `10.213.77.1` và giả được IP khách/vượt `allow` của `/api/health`. Tiến trình bất kỳ chạy trên chính host vẫn giả được header (cùng ranh giới tin cậy với cloudflared).

Yêu cầu: Docker + Compose v2. Không cần sudo (user thuộc nhóm `docker`).

## 1. Tạo `.env`

```bash
cp .env.example .env && chmod 600 .env
mkdir -p backups        # BACKUP_DIR mặc định; tạo trước để thuộc user của bạn (nếu để docker tạo sẽ thuộc root)
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

Compose không dùng `env_file`: mỗi service chỉ nhận biến nó cần (portal: `DATABASE_URL`, `SESSION_SECRET`, `COOKIE_SECURE`, `UPLOAD_DIR`, `TRUST_PROXY`, `CLIENT_IP_HEADER`, `NODE_ENV`, `UV_THREADPOOL_SIZE`; migrate: `DATABASE_URL`, `ADMIN_USER`, `ADMIN_INITIAL_PASSWORD`). Portal không thấy `ADMIN_INITIAL_PASSWORD`/`BACKUP_*`; mật khẩu DB của portal chỉ nằm trong `DATABASE_URL`. Rủi ro còn lại: container `backup` có `PGPASSWORD` trong env (compose không cho secret từ biến môi trường vào service `read_only`), nhìn thấy qua `docker inspect` (người có quyền docker vốn đã tương đương root host).

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
./scripts/restore.sh                   # hỏi xác nhận (gõ "restore"); backup hiện tại -> dừng portal+gateway -> GHI ĐÈ DB và uploads -> bật lại
./scripts/restore.sh --db FILE --uploads FILE --yes
./scripts/restore.sh --skip-backup     # không sao lưu trạng thái hiện tại trước khi ghi đè (mặc định có)
```

`restore.sh` không `source .env` (chỉ đọc `BACKUP_DIR`, `BACKUP_UID/GID`, `COMPOSE_PROJECT_NAME` như văn bản). Thứ tự an toàn: giải nén uploads vào thư mục tạm trong volume, rồi `pg_restore --single-transaction --exit-on-error` (lỗi => rollback, DB cũ còn nguyên), rồi mới thay uploads. Lỗi ở bất kỳ bước nào: giữ nguyên dữ liệu hiện tại và bật lại portal+gateway. `BACKUP_KEEP` phải là số nguyên >= 1.

Nên chép `BACKUP_DIR` ra máy/ổ khác (cùng máy chưa phải backup thật).

## 5. Cập nhật

```bash
./scripts/cap-nhat.sh                  # git pull --ff-only, backup, build, migrate, up -d, chờ healthy
SKIP_PULL=1 ./scripts/cap-nhat.sh      # không pull
```

Nếu portal không healthy sau cập nhật, script trả ảnh `portal-app:rollback` (ảnh trước đó) và thoát mã 1. Rollback chỉ lùi ứng dụng; migration DB là một chiều. Muốn lùi cả DB: `./scripts/restore.sh` (bản backup do script vừa tạo trước khi build).

## 6. Thêm tool phía sau gateway

Đặt file `*.conf` (các khối `location`) vào `nginx/conf.d/tools/`, rồi `docker compose exec gateway nginx -t && docker compose exec gateway nginx -s reload`. Mẫu `auto-pull-nas.conf.example` (`/auto-pull-nas/` → `host.docker.internal:18780`; khi bật, đường dẫn này KHÔNG qua xác thực của portal): tắt mặc định vì frontend auto-pull-nas hiện chưa có base path `/auto-pull-nas/`; chỉ bật sau khi PR base path của repo đó được merge và deploy.

## 7. Đường vào công khai (ĐÃ TRIỂN KHAI 27/11/2026): domain → router 192.168.10.1 → gateway

Thực tế đã kiểm: `xldl-hye.tumiki.org` trỏ về IP công cộng của mạng; một proxy nginx ở router `192.168.10.1` kết thúc TLS rồi chuyển tới `192.168.10.240:18780` và gắn IP khách vào cuối `X-Forwarded-For`. (`apn-tunnel` là quick tunnel `trycloudflare`, không liên quan tới domain này.)

Cấu hình hiện tại (không cần đổi gì ở router):
- Gateway portal nghe `192.168.10.240:18780` (`GATEWAY_BIND`/`GATEWAY_PORT` trong `.env`). Cổng `18780` trước đây là của web auto-pull-nas; web này đã chuyển sang `18781` (`WEB_PORT=18781` trong `.env` của auto-pull-nas) và build với `WEB_BASE_PATH=/auto-pull-nas/`.
- `/` → portal; `/auto-pull-nas/` → `host.docker.internal:18781` (`nginx/conf.d/tools/auto-pull-nas.conf`, cắt tiền tố; auto-pull-nas tự có đăng nhập riêng, KHÔNG qua xác thực portal).
- IP khách: gateway chỉ tin `X-Forwarded-For` khi kết nối đến từ `192.168.10.1` (`set_real_ip_from` trong `nginx/portal.conf`) và lấy phần tử CUỐI. Máy LAN nối thẳng vào gateway không giả được IP (đã kiểm: gửi XFF giả vẫn bị ghi IP thật).
- Cookie portal luôn `Secure`/`__Host-`: dùng qua https (domain). Mở `http://192.168.10.240:18780` trực tiếp trong LAN thì đăng nhập sẽ không giữ được phiên.
- `/api/health` bị 403 từ ngoài (chỉ curl từ chính máy qua mạng edge); kiểm tra nội bộ: `docker compose exec portal node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>r.text()).then(console.log)"`.

Quay lui (≈15 giây gián đoạn), theo thứ tự:
1. Portal: bỏ `GATEWAY_BIND`, đặt lại `GATEWAY_PORT=18790` trong `.env`, `docker compose up -d --no-deps gateway` (cổng 18780 được giải phóng).
2. auto-pull-nas: xoá `WEB_PORT=18781` khỏi `.env`, `docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.cluster.yml up -d --no-deps web` (đủ 3 file: thiếu cluster.yml thì API/số liệu sai).
Ảnh web có tiền tố vẫn chạy ở gốc `/` (rewrite `/auto-pull-nas/` → `/`), nên giữ `WEB_BASE_PATH` cũng được.

Nếu đổi proxy phía trước (đổi IP router, hoặc dùng Cloudflare named tunnel): sửa `set_real_ip_from` và `real_ip_header` (Cloudflare: `CF-Connecting-IP`, nguồn tin cậy là gateway mạng edge `10.213.77.1`, bind `127.0.0.1`) rồi `docker compose exec gateway nginx -s reload`. Tuyệt đối không để gateway nghe trên giao diện mà người ngoài tới được trừ qua proxy tin cậy.

## 7b. Ghim ảnh

`docker-compose.yml` ghim `postgres:16.15-alpine@sha256:721873c3…` và `nginx:1.27.5-alpine@sha256:65645c7b…` (digest lấy bằng `docker image inspect --format '{{.RepoDigests}}'` của ảnh đã kiểm thử). Nâng cấp: `docker pull postgres:16-alpine` (hoặc tag mới), `docker image inspect postgres:16-alpine --format '{{index .RepoDigests 0}}'`, sửa cả tag lẫn digest trong compose và `restore.sh` tự theo (đọc ảnh từ `docker compose config --images`). Lưu ý tag `16.15-alpine` trên registry có thể trỏ digest khác khi Alpine rebuild; digest ghim là bản đã chạy thử.

## 8. Dọn dẹp / gỡ

```bash
docker compose down          # giữ dữ liệu
docker compose down -v       # XOÁ volume pgdata và uploads (mất dữ liệu)
```
