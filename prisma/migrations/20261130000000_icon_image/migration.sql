-- Ảnh biểu tượng tuỳ chọn cho item và topic (ADR 0004). Không sửa migration cũ.
-- Ảnh nằm CÙNG HÀNG với item/topic: xoá hàng là xoá ảnh. Chỉ ADD COLUMN nullable (không viết lại bảng, hàng cũ giữ nguyên).
ALTER TABLE "item"
  ADD COLUMN "icon_image" BYTEA,
  ADD COLUMN "icon_mime" TEXT,
  ADD COLUMN "icon_updated_at" TIMESTAMPTZ(6);

ALTER TABLE "topic"
  ADD COLUMN "icon_image" BYTEA,
  ADD COLUMN "icon_mime" TEXT,
  ADD COLUMN "icon_updated_at" TIMESTAMPTZ(6);

-- Giới hạn 64 KB, mime chỉ png/jpeg/webp/gif, và ảnh/mime/thời điểm luôn có hoặc không cùng nhau.
ALTER TABLE "item"
  ADD CONSTRAINT "item_icon_image_size_chk" CHECK (icon_image IS NULL OR octet_length(icon_image) <= 65536),
  ADD CONSTRAINT "item_icon_mime_chk" CHECK (icon_mime IS NULL OR icon_mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  ADD CONSTRAINT "item_icon_image_set_chk" CHECK ((icon_image IS NULL) = (icon_mime IS NULL) AND (icon_image IS NULL) = (icon_updated_at IS NULL));

ALTER TABLE "topic"
  ADD CONSTRAINT "topic_icon_image_size_chk" CHECK (icon_image IS NULL OR octet_length(icon_image) <= 65536),
  ADD CONSTRAINT "topic_icon_mime_chk" CHECK (icon_mime IS NULL OR icon_mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  ADD CONSTRAINT "topic_icon_image_set_chk" CHECK ((icon_image IS NULL) = (icon_mime IS NULL) AND (icon_image IS NULL) = (icon_updated_at IS NULL));
