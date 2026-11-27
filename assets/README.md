# Portal assets

Tự vẽ, không dùng asset bên thứ ba, không logo tổ chức thật.

- `logo-horizontal.svg`, `logo-square.svg`, `favicon.svg`: màu nhấn lấy từ `--accent` (mặc định #0d9488), chữ từ `--ink`. Dùng inline hoặc `<img>` (khi `<img>` thì dùng màu mặc định).
- `icons/*.svg`: 24x24, stroke `currentColor`, độ dày 1.75. Nhúng inline hoặc dùng mask để đổi màu theo theme.
- `illustrations/*.svg`: trạng thái trống; nét/khối dùng `currentColor`, nhấn `--accent`, nền kính lúp `--bg`. Nhúng inline để theo theme sáng/tối.
- `preview.html`: xem toàn bộ, có nút Sáng/Tối.
