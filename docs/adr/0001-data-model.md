# ADR 0001: Mô hình dữ liệu

Trạng thái: đề xuất (wave 1). Nguồn: `docs/SPEC.md`.

## Quyết định chính
- **Prisma 7.10.1 (bản stable), không dùng 8.0.0-rc**: 8 mới ở bản rc. Cấu hình ở `prisma.config.ts` (URL từ `DATABASE_URL`), client sinh ra `prisma/generated` (nên thêm vào `.gitignore`), chạy qua `@prisma/adapter-pg`.
- **Khoá**: `uuid` (`gen_random_uuid()`, sẵn trong PG 16) cho bảng nghiệp vụ; `bigint identity` cho `audit_log`, `login_attempt` (nhiều dòng, chỉ thêm). Mọi thời gian là `timestamptz`.
- **Tìm kiếm tiếng Việt**: cột `search tsvector GENERATED ALWAYS ... STORED` trên `item` (title=A, description=B) và `note`, GIN index. Dùng cấu hình `simple` + `f_unaccent()` (hàm bọc IMMUTABLE quanh `unaccent`, vì `unaccent` gốc chỉ STABLE nên không dùng được trong generated column). Truy vấn phải bọc cùng hàm: `search @@ websearch_to_tsquery('simple', f_unaccent($1))`. Không stemming (tiếng Việt không có), nên "ha noi" khớp "Hà Nội". Tìm theo tiền tố: `to_tsquery('simple', f_unaccent('hung') || ':*')`.
- **Xoá topic**: `Restrict` cho cả `item.topic_id` lẫn `topic.parent_id`. Xoá topic còn item/topic con sẽ lỗi thay vì mất dữ liệu âm thầm; ứng dụng phải bắt người dùng chọn chuyển item sang topic khác hoặc "chưa phân loại" (`topic_id = NULL`) rồi mới xoá, và ghi `audit_log`.
- **Xoá item**: `Cascade` xuống `item_tag`, `file`, `note`, `note_version` (là dữ liệu con của item). Hàng `file` mất thì blob trong `UPLOAD_DIR` mồ côi: ứng dụng phải xoá blob (hoặc job dọn theo `storage_key`) và ghi audit. Xoá user: `SetNull` cho các cột tác giả; `session` thì `Cascade`.
- **slug topic duy nhất theo cha**: `unique(parent_id, slug)` + partial unique index cho topic gốc (`WHERE parent_id IS NULL`), vì unique thường coi NULL là khác nhau. Định dạng slug và "không tự làm cha" có CHECK. Chống chu trình dài (A->B->A) để ứng dụng kiểm tra khi di chuyển (CTE đệ quy).
- **Auth**: `user.password_hash` (argon2id), `must_change_password` mặc định true. `session.token_hash` lưu sha256 của token trong cookie, không lưu token thô. `login_attempt(username, ip, success, created_at)` để rate limit bằng đếm trong cửa sổ thời gian; cần job xoá dòng cũ.
- **Seed**: admin tạo từ `ADMIN_USER`/`ADMIN_INITIAL_PASSWORD`, từ chối giá trị `CHANGE_ME`; chạy lại không ghi đè mật khẩu đã đổi. Chỉ topic mẫu trung tính.
- **`file.sha256`** `char(64)` có CHECK hex; không unique để cho phép cùng nội dung ở nhiều item.
- **Note**: 1-1 với item (`note.item_id` unique), `note_version` là lịch sử bất biến `(note_id, version)`; ứng dụng ghi version mới và cập nhật `note.body_md`/`current_version` trong một transaction.

## Hạn chế đã biết
- Prisma không biểu diễn được cột generated, partial index, CHECK: chúng nằm trong SQL tay của migration. `prisma migrate diff` báo nhiễu `ALTER COLUMN search DROP DEFAULT`; **chỉ dùng `migrate deploy`**, đừng chạy `migrate dev` mà không đọc SQL sinh ra.
- `updated_at` không có default ở DB (do Prisma `@updatedAt` đặt); INSERT SQL thô phải tự điền.
- Tìm kiếm chưa gồm tag và `original_name` của file (nằm ở bảng khác); lọc tag làm bằng join.

## Việc bắt buộc cho tầng ứng dụng (từ review độc lập, 27/11/2026)
- Cắt `username`/`ip` về tối đa 64 ký tự trước khi ghi `login_attempt` (DB có CHECK; nếu không cắt, INSERT sẽ lỗi).
- Kiểm tra chu trình topic (A→B→A) bằng CTE đệ quy có giới hạn độ sâu; viết test.
- `note.current_version` tăng trong transaction: `UPDATE ... SET current_version = current_version + 1 RETURNING`; tạo note thì ghi luôn `note_version` v1; retry khi trùng version.
- Validate URL bằng `new URL()` khi ghi và khi render; UI mặc định "lưu trữ" (`status=archived`) thay vì xoá cứng item.
- Đổi mật khẩu hoặc đăng xuất: xoá session của user. Job dọn `session` và `login_attempt` cũ. Xoá blob trong UPLOAD_DIR khi xoá item.
- Role chạy migrate phải là owner của DB (cần `CREATE EXTENSION unaccent`).

## Phân quyền: `role` chưa được kiểm ở server (ghi nhận 28/11/2026)
`user.role` (`admin|user`) có trong DB và trong `/api/auth/me` nhưng **không có route nào kiểm nó**: mọi người dùng đã đăng nhập đều làm được mọi thao tác (tạo/sửa/xoá topic, item, file, note). Hiện chỉ có một tài khoản admin do seed tạo nên chưa là lỗ hổng. **Trước khi thêm người dùng thường** (bằng bất kỳ đường nào) phải thêm kiểm quyền ở server (ví dụ tham số `requireRole` trong `route()` và sở hữu theo `created_by_id`) cùng test từ chối; ẩn nút ở UI không đủ.
