-- Thêm cột ghim và "mở gần đây" cho item (API.md: pinned, lastOpenedAt).
ALTER TABLE "item" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "item" ADD COLUMN "last_opened_at" TIMESTAMPTZ(6);

CREATE INDEX "item_pinned_idx" ON "item"("pinned") WHERE "pinned";
CREATE INDEX "item_last_opened_at_idx" ON "item"("last_opened_at") WHERE "last_opened_at" IS NOT NULL;
