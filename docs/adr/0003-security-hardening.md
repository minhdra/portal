# ADR 0003: Cứng hoá bảo mật (review wave 2, 28/11/2026)

## Header (next.config.ts)
- CSP: `default-src 'self'; script-src 'self' 'unsafe-inline' (+ 'unsafe-eval' chỉ ở dev); style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
  - **Vì sao `'unsafe-inline'` cho script**: Next nhúng script hydrate nội tuyến (`self.__next_f.push`) và layout có `THEME_SCRIPT` chống nháy giao diện. Nonce buộc mọi trang render động qua `proxy` và mất cache tĩnh; chưa đáng với một app một người dùng. Bù lại: không `unsafe-eval` ở production, `object-src 'none'`, `base-uri 'self'`, nội dung người dùng (markdown, docx) bị lọc HTML. Có thể nâng lên nonce sau mà không đổi code ứng dụng.
  - `style-src 'unsafe-inline'`: React `style={}` và `<style>` do Next chèn.
  - `img-src data:`: ảnh docx nhúng data URI (đã lọc chỉ png/jpeg/gif).
- `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` tắt camera/mic/vị trí/thanh toán/usb, `X-Content-Type-Options: nosniff`, HSTS 1 năm (chỉ production).
- `/api/files/*` loại khỏi CSP chung: route tự đặt CSP (`sandbox`, hoặc `default-src 'none'` cho PDF) và giữ nguyên; cấu hình chỉ thêm `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` để iframe PDF cùng origin xem được. Hai CSP cùng hiệu lực (giao nhau).

## Cookie
`COOKIE_SECURE=1` hoặc `NODE_ENV=production`: luôn `Secure`, tên `__Host-portal_session` (trình duyệt buộc Secure + Path=/ + không Domain, chống cookie tossing từ subdomain). Không còn tin `X-Forwarded-Proto` ở chế độ này. Hệ quả: production phải truy cập qua https (hoặc `localhost`); http thuần qua IP LAN sẽ không giữ được phiên. Dev: tên thường, Secure theo scheme. Triển khai cũ đổi tên cookie: mọi phiên hiện có bị đăng xuất một lần.

## Phiên
Thêm `session.absolute_expires_at` = tạo + 60 ngày; gia hạn trượt (14 ngày) không bao giờ vượt mốc này. Bỏ `timingSafeEqual` (so hash với chính hash vừa tra theo unique index, vô nghĩa).

## Xem docx/xlsx
Tệp tối đa 10 MB; lọc central directory (<= 5000 mục, tổng kích thước khai báo <= 50 MB) rồi parse trong `worker_threads` (eval, `resourceLimits` heap 192 MB, timeout 10 s, tối đa 2 worker, hàng đợi 16). Worker tự giải nén thật từng mục với `maxOutputLength`, không tin kích thước khai báo (zip bomb khai nhỏ) nên tổng giải nén thật <= 50 MB; vượt -> 413, hỏng/quá giờ -> 422. Heap giới hạn nhưng bộ nhớ ngoài heap (Buffer) thì không: trần 50 MB giải nén là lớp chặn chính. `mammoth`/`read-excel-file` đặt trong `serverExternalPackages` và nạp bằng `require` từ `process.cwd()` trong worker; `view.ts` vẫn import tĩnh để bản standalone chép chúng.

## Upload, note
- Upload kiểm cả lô trước khi ghi blob đầu tiên; semaphore 3 request đồng thời (mỗi request giữ tới 120 MB RAM), hàng đợi 8.
- Unique `(item_id, sha256)`. Migration xoá hàng trùng (giữ hàng cũ nhất); blob của hàng bị xoá thành mồ côi trên đĩa (migration không đụng được `UPLOAD_DIR`), dọn tay nếu cần: `storage_key` không còn trong bảng `file`.
- `ensureNote` dùng `INSERT ... ON CONFLICT DO NOTHING`; GET chỉ ghi khi note chưa có (tạo lười).
- Markdown chứa NUL -> 422. **Giữ tối đa 200 phiên bản/note**, xoá bản cũ nhất khi vượt (chặn bảng `note_version` phình vô hạn: 1 triệu ký tự x số lần lưu). Khôi phục một bản đã bị cắt trả 404. Trần lý thuyết 200 x 1 MB = 200 MB/note.
- Reorder: `ids` phải là đúng tập anh em (thiếu/thừa -> 422).
