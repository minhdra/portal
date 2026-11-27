# ADR 0004: Ảnh biểu tượng tuỳ chọn cho item và topic (30/11/2026)

## Quyết định
- Ảnh lưu trong Postgres: `icon_image BYTEA`, `icon_mime TEXT`, `icon_updated_at TIMESTAMPTZ` trên cả `item` và `topic` (migration `20261130000000_icon_image`, chỉ `ADD COLUMN` nullable nên bảng có dữ liệu cũ không bị viết lại). CHECK: `octet_length <= 65536`, mime thuộc `png|jpeg|webp|gif`, ba cột cùng NULL hoặc cùng có giá trị.
- Route `PUT|DELETE|GET /api/{items,topics}/:id/icon` (docs/API.md). DTO thêm `iconImageUrl` (kèm `?v=<icon_updated_at>`); UI dùng ảnh nếu có, ngược lại icon tên (`icon`) như cũ.
- Server kiểm magic bytes bằng `file-type` (không tin Content-Type/tên tệp), chỉ nhận 4 loại ảnh raster; SVG/HTML bị 415. Quá 64 KB bị 413 khi đọc luồng.
- Trình duyệt thu nhỏ trước khi gửi: cắt giữa thành vuông, 128x128 PNG nền trong suốt (thử 96/64 nếu vẫn > 64 KB). Ảnh chỉ gửi lên khi bấm Lưu.
- Danh sách không kéo bytea: `PrismaClient` đặt `omit` toàn cục cho `iconImage` (item, topic); chỉ `services/icons.ts` chọn tường minh. Truy vấn thô tìm kiếm topic chỉ lấy `icon_updated_at`.

## Vì sao
- Postgres thay vì `UPLOAD_DIR`: một nơi để backup (pg_dump đã có), xoá item/topic xoá luôn ảnh (cùng hàng, không blob mồ côi), không cần dọn tệp, transaction với audit. Ảnh nhỏ (<= 64 KB) nên không đáng kể về dung lượng.
- Cột trên chính bảng (không tách bảng `icon`): quan hệ 1-1 tuỳ chọn, tách ra chỉ thêm JOIN; chi phí đọc cột lớn được chặn bằng `omit`. TOAST lưu bytea > ~2 KB ngoài dòng nên quét bảng không đọc ảnh.
- Cache: URL có `?v=` đổi mỗi lần đổi ảnh nên dùng `immutable`; `private` vì cần đăng nhập. `ETag` để tải lại khi không có `?v=`.

## Bảo mật
- Ảnh người dùng tải lên là dữ liệu không tin cậy: chỉ raster, `nosniff`, CSP `default-src 'none'; sandbox`, CORP `same-origin`. Không SVG vì SVG chạy được script khi mở trực tiếp.
- `next.config.ts` KHÔNG đặt CSP cho `/api/(items|topics)/:id/icon` (cùng lý do `/api/files/*` ở ADR 0003: header cấu hình ghi đè header của route). CSP chung `img-src 'self' data:` đã đủ cho `<img src="/api/.../icon">`; bản mock dùng `data:` URL.
- Kiểm magic bytes chỉ xác nhận phần đầu tệp; ảnh hỏng phía sau vẫn có thể được lưu (trình duyệt sẽ không vẽ được, UI rơi về icon tên). Không giải mã/ghi lại ảnh ở server (không thêm thư viện xử lý ảnh).

## Giới hạn
- Một ảnh cho mỗi item/topic, không lịch sử; thay ảnh là ghi đè. Lưu trữ (archive) item không xoá ảnh, xoá cứng thì xoá.
- Tối đa 64 KB, 4 loại ảnh. GIF động nếu có sẽ bị client chuyển thành khung đầu (PNG); gọi API trực tiếp thì GIF động được giữ nguyên.
- Form "Thêm topic" nhanh chưa có ô ảnh; đặt ảnh qua nút Sửa của topic. Chưa dọn ảnh ở bản sao lưu cũ (migration chỉ thêm cột).
- Rollback: migration chỉ thêm cột, bản code cũ vẫn chạy với DB mới (bỏ qua cột lạ).
