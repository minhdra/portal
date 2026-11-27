Thêm tool phía sau gateway: tạo file `*.conf` trong thư mục này, chứa các khối `location` (được include vào server của
`nginx/portal.conf`). Mẫu: `auto-pull-nas.conf.example` (đổi tên thành `auto-pull-nas.conf` để bật), rồi
`docker compose exec gateway nginx -t && docker compose exec gateway nginx -s reload`.
