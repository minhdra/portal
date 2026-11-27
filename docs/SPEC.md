# SPEC — portal

## Mục tiêu
Một nơi lưu và mở mọi tool/web/tài liệu của chủ dự án. Bấm vào thẻ thì mở đích. Dữ liệu động: sửa, upload, xem file, soạn Markdown.

## Kiến trúc
gateway (nginx) → `/` portal (Next.js standalone) ; `/auto-pull-nas/` → auto-pull-nas-web (compose riêng, không đụng) ; thêm tool khác bằng cấu hình.
portal ↔ Postgres 16 (container riêng, backup hằng ngày) ; file upload ở volume `/data/uploads`.
Tunnel Cloudflare `xldl-hye.tumiki.org` chuyển sang gateway ở wave 4, chỉ khi chủ dự án đồng ý, có cách quay lui.

## Dữ liệu
user, session, topic (cây, tự cấu hình, sắp xếp), item (tool|web|doc|note|link; tiêu đề, mô tả, url, icon, tag, trạng thái, topic), file (mime, size, sha256, item), note_version (lịch sử Markdown), audit_log. Full-text search bằng Postgres (unaccent, tiếng Việt).

## Tính năng
- Trang chủ theo topic, tìm kiếm, lọc tag, kéo thả sắp xếp.
- Xem trong trang: PDF, ảnh, Markdown; docx (mammoth→HTML, lọc sạch), xlsx (SheetJS→bảng), chỉ đọc.
- Soạn note Markdown có preview, lưu phiên bản, xuất .md/PDF, dán ảnh.
- Auth: admin khởi tạo từ `.env`, bắt đổi mật khẩu lần đầu, rate limit đăng nhập, argon2, cookie httpOnly. Tool phía sau tự giữ auth riêng.

## Ràng buộc
- Repo PUBLIC: không commit secret, dữ liệu thật, mật khẩu. Chỉ `.env.example`.
- Giao diện tiếng Việt. Sáng/tối. Tool được thêm bằng UI, không ghi cứng trong code.
- Sửa frontend auto-pull-nas (base path `/auto-pull-nas/`) = PR riêng ở repo đó, chưa deploy khi chưa được gật.

## Wave
0 spec+assets ; 1 schema + wireframe (chủ chọn) ; 2 API + UI ; 3 Docker/gateway/backup + e2e + security ; 4 nhập tool hiện có, chuyển tunnel (cần gật).
Mỗi wave: review độc lập trước khi chấp nhận.
