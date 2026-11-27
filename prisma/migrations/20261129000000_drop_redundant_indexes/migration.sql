-- Bỏ index thừa (review wave 2, L-g). Không sửa migration cũ.
-- file(item_id): đã được unique (item_id, sha256) phủ (item_id là cột đầu).
DROP INDEX IF EXISTS "file_item_id_idx";
-- login_attempt(username, created_at): mọi truy vấn lọc theo (kind, username, ...) nên dùng index (kind, username, created_at).
DROP INDEX IF EXISTS "login_attempt_username_created_at_idx";
