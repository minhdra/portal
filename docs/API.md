# API contract (nguồn sự thật cho wave 2; API agent và UI agent đều bám file này)

Mọi route dưới `/api`, JSON, UTF-8. Lỗi: HTTP 4xx/5xx + `{"error":{"code":"...","message":"tiếng Việt"}}`. Mã: `unauthenticated`(401) `forbidden`(403) `not_found`(404) `validation`(422, kèm `fields`) `conflict`(409) `rate_limited`(429) `must_change_password`(403).
Auth: cookie `portal_session` (httpOnly, SameSite=Lax, Secure khi https). Ghi (POST/PUT/PATCH/DELETE) kiểm tra header `Origin` cùng host (CSRF). Mọi route trừ `/api/auth/login` cần đăng nhập; nếu `mustChangePassword` thì chỉ `/api/auth/change-password`, `/api/auth/me`, `/api/auth/logout` được dùng.

## Auth
- `POST /api/auth/login` {username,password} → 200 {user}. Sai → 401 chung chung (không lộ user tồn tại). Rate limit theo username+ip qua `login_attempt` (vd 5 lần sai/15 phút → 429).
- `POST /api/auth/logout` → 204. `GET /api/auth/me` → {user:{id,username,displayName,role,mustChangePassword}}.
- `POST /api/auth/change-password` {currentPassword,newPassword(>=10 ký tự)} → 204, xoá mọi session khác của user.

## Topic (cây)
- `GET /api/topics` → {topics:[{id,parentId,name,slug,icon,sortOrder,itemCount,children:[...]}]}
- `POST /api/topics` {parentId?,name,icon?} (slug sinh từ name, bỏ dấu, chống trùng) → 201 topic
- `PATCH /api/topics/:id` {name?,icon?,parentId?} (chặn chu trình bằng CTE có giới hạn độ sâu → 409)
- `DELETE /api/topics/:id` → 204; còn item/con → 409 `conflict`
- `POST /api/topics/reorder` {parentId|null, ids:[uuid...]} → 204

## Item
Item DTO: {id,type:"tool|web|doc|note|link",title,description,url,icon,status:"active|archived",topicId,tags:[{id,name,slug}],pinned,sortOrder,fileCount,createdAt,updatedAt,lastOpenedAt}
- `GET /api/items?topic=<id>&q=&tag=<slug>&type=&status=active&pinned=1&recent=1&limit=50&cursor=` → {items,nextCursor}. `q` dùng cột `search` + `f_unaccent` (xem ADR 0001); `topic` gồm cả topic con.
- `POST /api/items` {type,title,description?,url?,icon?,topicId?,tags?:[name]} → 201 item
- `GET /api/items/:id`, `PATCH /api/items/:id` (các trường trên + status, pinned), `DELETE /api/items/:id` = lưu trữ (status=archived); `?hard=1` xoá cứng + xoá blob
- `POST /api/items/:id/open` → 204 (ghi lastOpenedAt cho "Gần đây")
- `POST /api/items/reorder` {topicId|null, ids:[...]} → 204
- `GET /api/tags` → {tags:[{id,name,slug,count}]}
- `GET /api/search?q=` → {items,topics} (gộp tìm item + note + topic)
Nếu schema thiếu cột `pinned`/`lastOpenedAt`: API agent thêm migration mới `20261127xxxxxx_pinned_recent` (KHÔNG sửa migration init) và báo lại.

## File
- `POST /api/items/:id/files` multipart (`file`, tối đa 50 MB, nhiều file) → 201 {files:[{id,originalName,mime,size,sha256}]}. Lưu ở `UPLOAD_DIR/<yyyy>/<mm>/<uuid>` (storage_key không chứa tên gốc), kiểm tra mime theo magic bytes, khử tên, chặn path traversal, dedupe theo sha256 trong cùng item.
- `GET /api/files/:id` stream (Range support); PDF/ảnh/text `inline`, còn lại `attachment`; header `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` cho file do người dùng upload.
- `GET /api/files/:id/view` → docx: {kind:"html",html} (mammoth, lọc sạch bằng allowlist, bỏ script/style/on*); xlsx: {kind:"sheets",sheets:[{name,rows:string[][],truncated}]} (SheetJS, giới hạn 2000 dòng/500 cột); khác → 415.
- `DELETE /api/files/:id` → 204 (xoá blob nếu không còn hàng nào tham chiếu).

## Note (item.type = note)
- `GET /api/items/:id/note` → {markdown,version,updatedAt}
- `PUT /api/items/:id/note` {markdown,baseVersion} → {version}; baseVersion lệch → 409 (tránh ghi đè), tăng current_version trong transaction và ghi `note_version`.
- `GET /api/items/:id/note/versions` → {versions:[{version,createdAt,author,size}]}; `GET .../versions/:v`; `POST .../versions/:v/restore` (tạo phiên bản mới từ bản cũ)
- `GET /api/items/:id/note/export?format=md` → file .md. Ảnh dán: `POST /api/items/:id/files` rồi chèn `![](/api/files/<id>)`.
- Render markdown ở client phải lọc HTML (không cho `<script>`/`on*`/`javascript:`).

## Quy tắc chung
- Validate đầu vào bằng zod; URL bằng `new URL()` + chỉ http(s) hoặc "/x".
- Ghi `audit_log` cho tạo/sửa/xoá/upload/đăng nhập.
- `GET /api/health` (không cần đăng nhập) → {ok:true}.
- Job dọn session/login_attempt cũ (hàm gọi lúc khởi động + mỗi 6 giờ).
