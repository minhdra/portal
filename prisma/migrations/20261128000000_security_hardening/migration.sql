-- Review bảo mật wave 2: login_attempt.kind (M1), session.absolute_expires_at (L2), unique (item_id, sha256) (L4).

-- M1: tách khoá đổi mật khẩu khỏi khoá đăng nhập bằng cột kind (thay cho tiền tố "cp:" trong username).
ALTER TABLE "login_attempt" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'login';
UPDATE "login_attempt" SET "kind" = 'cp', "username" = substr("username", 4) WHERE "username" LIKE 'cp:%';
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_kind_check" CHECK ("kind" IN ('login', 'cp'));
CREATE INDEX "login_attempt_kind_username_created_at_idx" ON "login_attempt"("kind", "username", "created_at");

-- L2: hạn tuyệt đối của phiên (60 ngày kể từ lúc tạo), không gia hạn được bằng trượt.
ALTER TABLE "session" ADD COLUMN "absolute_expires_at" TIMESTAMPTZ(6);
UPDATE "session" SET "absolute_expires_at" = "created_at" + interval '60 days';
ALTER TABLE "session" ALTER COLUMN "absolute_expires_at" SET NOT NULL;
ALTER TABLE "session" ALTER COLUMN "absolute_expires_at" SET DEFAULT (now() + interval '60 days');

-- L4: dọn trùng sẵn có (giữ hàng cũ nhất) rồi đặt unique. Blob của hàng bị xoá trở thành mồ côi trên đĩa
-- (migration không đụng được UPLOAD_DIR); xem docs/adr/0003-security-hardening.md.
DELETE FROM "file" f USING "file" g
 WHERE f."item_id" = g."item_id" AND f."sha256" = g."sha256"
   AND (f."created_at", f."id") > (g."created_at", g."id");
CREATE UNIQUE INDEX "file_item_id_sha256_key" ON "file"("item_id", "sha256");
