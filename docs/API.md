# API contract (nguồn sự thật cho wave 2; API agent và UI agent đều bám file này)

Mọi route dưới `/api`, JSON, UTF-8. Lỗi: HTTP 4xx/5xx + `{"error":{"code":"...","message":"tiếng Việt"}}`. Mã: `unauthenticated`(401) `forbidden`(403) `not_found`(404) `validation`(422, kèm `fields`) `conflict`(409) `rate_limited`(429) `must_change_password`(403).
Auth: cookie `portal_session` (httpOnly, SameSite=Lax). Khi `COOKIE_SECURE=1` hoặc `NODE_ENV=production`: luôn `Secure` và tên là `__Host-portal_session` (không phụ thuộc `X-Forwarded-Proto`); dev http: tên thường, Secure theo scheme. Phiên trượt 14 ngày nhưng có hạn tuyệt đối 60 ngày. Ghi (POST/PUT/PATCH/DELETE) kiểm tra header `Origin` cùng host (CSRF). Mọi route trừ `/api/auth/login` cần đăng nhập; nếu `mustChangePassword` thì chỉ `/api/auth/change-password`, `/api/auth/me`, `/api/auth/logout` được dùng.

## Auth
- `POST /api/auth/login` {username,password} → 200 {user}. Sai → 401 chung chung (không lộ user tồn tại). Rate limit qua `login_attempt` (cột `kind` = `login`|`cp`), đặt chỗ trước khi verify nên song song không vượt ngưỡng: 5 lần sai/15 phút theo (username, ip) và 30 theo ip → 429 `Retry-After`; theo username (mọi ip) là làm chậm dần, không khoá cứng (ADR 0002). IP khách lấy từ `CLIENT_IP_HEADER` (mặc định `X-Client-IP`, do gateway đặt/ghi đè; IPv6 gom theo /64) chỉ khi `TRUST_PROXY=1`, nếu không là `unknown` (khi đó chỉ còn làm chậm theo username). Đăng nhập đúng còn đặt cookie `portal_device` (`__Host-portal_device` ở production) giúp thiết bị quen được miễn làm chậm theo username (ADR 0002). Lượt bị 429 vì máy chủ bận (hàng đợi argon2 đầy) không tính là lần sai.
- `POST /api/auth/logout` → 204. `GET /api/auth/me` → {user:{id,username,displayName,role,mustChangePassword}}.
- `POST /api/auth/change-password` {currentPassword,newPassword(>=10 ký tự)} → 204, xoá mọi session khác của user.

## Topic (cây)
- `GET /api/topics` → {topics:[{id,parentId,name,slug,icon,sortOrder,itemCount,children:[...]}]}
- `POST /api/topics` {parentId?,name,icon?} (slug sinh từ name, bỏ dấu, chống trùng) → 201 topic
- `PATCH /api/topics/:id` {name?,icon?,parentId?} (chặn chu trình bằng CTE có giới hạn độ sâu → 409)
- `DELETE /api/topics/:id` → 204; còn item/con → 409 `conflict`
- `POST /api/topics/reorder` {parentId|null, ids:[uuid...]} → 204. `ids` phải là ĐÚNG tập chủ đề con của `parentId` (thiếu/thừa/trùng → 422).

## Item
Item DTO: {id,type:"tool|web|doc|note|link",title,description,url,icon,status:"active|archived",topicId,tags:[{id,name,slug}],pinned,sortOrder,fileCount,createdAt,updatedAt,lastOpenedAt}
- `GET /api/items?topic=<id>&q=&tag=<slug>&type=&status=active&pinned=1&recent=1&limit=50&cursor=` → {items,nextCursor}. `q` dùng cột `search` + `f_unaccent` (xem ADR 0001); `topic` gồm cả topic con.
- `POST /api/items` {type,title,description?,url?,icon?,topicId?,tags?:[name]} → 201 item
- `GET /api/items/:id`, `PATCH /api/items/:id` (các trường trên + status, pinned), `DELETE /api/items/:id` = lưu trữ (status=archived); `?hard=1` xoá cứng + xoá blob
- `POST /api/items/:id/open` → 204 (ghi lastOpenedAt cho "Gần đây")
- `POST /api/items/reorder` {topicId|null, ids:[...]} → 204. `ids` phải là ĐÚNG tập mục chưa lưu trữ của chủ đề (thiếu/thừa/trùng → 422); UI không được gửi tập con.
- `GET /api/tags` → {tags:[{id,name,slug,count}]}
- `GET /api/search?q=` → {items,topics} (gộp tìm item + note + topic)
Nếu schema thiếu cột `pinned`/`lastOpenedAt`: API agent thêm migration mới `20261127xxxxxx_pinned_recent` (KHÔNG sửa migration init) và báo lại.

## File
- `POST /api/items/:id/files` multipart (`file`, tối đa 50 MB, nhiều file) → 201 {files:[{id,originalName,mime,size,sha256}]}. Lưu ở `UPLOAD_DIR/<yyyy>/<mm>/<uuid>` (storage_key không chứa tên gốc), kiểm tra mime theo magic bytes, khử tên, chặn path traversal, dedupe theo sha256 trong cùng item (unique `(item_id, sha256)`; đua nhau vẫn trả bản cũ `duplicate:true`). Cả lô được kiểm tra (rỗng/size/mime) trước khi ghi tệp đầu tiên; tối đa 3 request upload xử lý đồng thời, hàng đợi đầy → 429.
- `GET /api/files/:id` stream (Range support); PDF/ảnh/text `inline`, còn lại `attachment`; header `X-Content-Type-Options: nosniff`, `Content-Security-Policy` do route đặt (một header duy nhất): `sandbox; frame-ancestors 'self'` (PDF: `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'`), kể cả `?download=1`.
- `GET /api/files/:id/view` → docx: {kind:"html",html} (mammoth, lọc sạch bằng allowlist trong worker, bỏ script/style/on*; HTML tối đa 2 MB → 413); xlsx: {kind:"sheets",sheets:[{name,rows:string[][],truncated}]} (SheetJS, giới hạn 2000 dòng/500 cột, tổng 2 MB ký tự, 1.000.000 ô, 50 sheet; vượt thì cắt và `truncated: true`); khác → 415. Tệp tối đa 10 MB, giải nén thật tối đa 50 MB (không tin kích thước khai báo) → 413; parse chạy trong worker_threads có giới hạn heap và timeout 10 giây (quá hạn/hỏng → 422).
- `DELETE /api/files/:id` → 204 (xoá blob nếu không còn hàng nào tham chiếu).

## Note (item.type = note)
- `GET /api/items/:id/note` → {markdown,version,updatedAt}
- `PUT /api/items/:id/note` {markdown,baseVersion} → {version}; `markdown` chứa NUL (`\u0000`) → 422; chỉ giữ 200 phiên bản mới nhất (ADR 0003); baseVersion lệch → 409 (tránh ghi đè), tăng current_version trong transaction và ghi `note_version`.
- `GET /api/items/:id/note/versions` → {versions:[{version,createdAt,author,size}]}; `GET .../versions/:v`; `POST .../versions/:v/restore` (tạo phiên bản mới từ bản cũ)
- `GET /api/items/:id/note/export?format=md` → file .md. Ảnh dán: `POST /api/items/:id/files` rồi chèn `![](/api/files/<id>)`.
- Render markdown ở client phải lọc HTML (không cho `<script>`/`on*`/`javascript:`).

## Quy tắc chung
- Validate đầu vào bằng zod; URL bằng `new URL()` + chỉ http(s) hoặc "/x".
- Ghi `audit_log` cho tạo/sửa/xoá/upload/đăng nhập.
- `GET /api/health` (không cần đăng nhập) → {ok:true}.
- Job dọn session/login_attempt cũ (hàm gọi lúc khởi động + mỗi 6 giờ).
