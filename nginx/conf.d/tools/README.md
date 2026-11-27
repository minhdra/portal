Thêm tool phía sau gateway: tạo file `*.conf` trong thư mục này, chứa các khối `location` (được include vào server của
`nginx/portal.conf`). Mẫu đang dùng: `auto-pull-nas.conf`. Sau khi sửa:
`docker compose exec gateway nginx -t && docker compose exec gateway nginx -s reload`.
Mỗi tool cùng origin với portal (cùng tên miền): đọc ghi chú an ninh đầu file mẫu trước khi thêm.
