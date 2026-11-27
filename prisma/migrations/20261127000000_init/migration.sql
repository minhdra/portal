-- Extension + hàm bọc immutable (unaccent() gốc chỉ STABLE nên không dùng được trong generated column / index).
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN unaccent('unaccent'::regdictionary, $1);

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "item_type" AS ENUM ('tool', 'web', 'doc', 'note', 'link');

-- CreateEnum
CREATE TYPE "item_status" AS ENUM ('active', 'draft', 'archived');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "display_name" TEXT,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" BIGSERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "topic_id" UUID,
    "type" "item_type" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "icon" TEXT,
    "status" "item_status" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "search" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', f_unaccent(coalesce("title", ''))), 'A') ||
        setweight(to_tsvector('simple', f_unaccent(coalesce("description", ''))), 'B')
    ) STORED,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_tag" (
    "item_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "item_tag_pkey" PRIMARY KEY ("item_id","tag_id")
);

-- CreateTable
CREATE TABLE "file" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "body_md" TEXT NOT NULL DEFAULT '',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "search" tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', f_unaccent(coalesce("body_md", '')))
    ) STORED,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "body_md" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempt_username_created_at_idx" ON "login_attempt"("username", "created_at");

-- CreateIndex
CREATE INDEX "login_attempt_ip_created_at_idx" ON "login_attempt"("ip", "created_at");

-- CreateIndex
CREATE INDEX "login_attempt_created_at_idx" ON "login_attempt"("created_at");

-- CreateIndex
CREATE INDEX "topic_parent_id_sort_order_idx" ON "topic"("parent_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "topic_parent_id_slug_key" ON "topic"("parent_id", "slug");

-- CreateIndex
CREATE INDEX "item_topic_id_sort_order_idx" ON "item"("topic_id", "sort_order");

-- CreateIndex
CREATE INDEX "item_type_idx" ON "item"("type");

-- CreateIndex
CREATE INDEX "item_status_idx" ON "item"("status");

-- CreateIndex
CREATE INDEX "item_created_by_id_idx" ON "item"("created_by_id");

-- CreateIndex
CREATE INDEX "item_search_idx" ON "item" USING GIN ("search");

-- CreateIndex
CREATE UNIQUE INDEX "tag_slug_key" ON "tag"("slug");

-- CreateIndex
CREATE INDEX "item_tag_tag_id_idx" ON "item_tag"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_storage_key_key" ON "file"("storage_key");

-- CreateIndex
CREATE INDEX "file_item_id_idx" ON "file"("item_id");

-- CreateIndex
CREATE INDEX "file_sha256_idx" ON "file"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "note_item_id_key" ON "note"("item_id");

-- CreateIndex
CREATE INDEX "note_search_idx" ON "note" USING GIN ("search");

-- CreateIndex
CREATE INDEX "note_version_created_by_id_idx" ON "note_version"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_version_note_id_version_key" ON "note_version"("note_id", "version");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic" ADD CONSTRAINT "topic_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_tag" ADD CONSTRAINT "item_tag_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_tag" ADD CONSTRAINT "item_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file" ADD CONSTRAINT "file_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file" ADD CONSTRAINT "file_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_version" ADD CONSTRAINT "note_version_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_version" ADD CONSTRAINT "note_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===== Ràng buộc & index mà Prisma không biểu diễn được =====

-- slug topic gốc (parent_id IS NULL) duy nhất; unique(parent_id, slug) ở trên không bắt NULL.
CREATE UNIQUE INDEX "topic_root_slug_key" ON "topic"("slug") WHERE "parent_id" IS NULL;

ALTER TABLE "topic" ADD CONSTRAINT "topic_not_self_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "topic" ADD CONSTRAINT "topic_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "tag" ADD CONSTRAINT "tag_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "user" ADD CONSTRAINT "user_username_lower" CHECK ("username" = lower("username"));
ALTER TABLE "file" ADD CONSTRAINT "file_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "file" ADD CONSTRAINT "file_size_nonneg" CHECK ("size" >= 0);
ALTER TABLE "note_version" ADD CONSTRAINT "note_version_positive" CHECK ("version" >= 1);
-- url nếu có: http(s)://host... hoặc đường dẫn nội bộ "/x" (chặn "//host", "/\host", khoảng trắng, ký tự điều khiển).
ALTER TABLE "item" ADD CONSTRAINT "item_url_scheme" CHECK ("url" IS NULL OR "url" ~* '^(https?://[^[:space:][:cntrl:]/\\]+[^[:space:][:cntrl:]]*|/([^[:space:][:cntrl:]/\\][^[:space:][:cntrl:]]*)?)$');
-- loại web/link bắt buộc có url.
ALTER TABLE "item" ADD CONSTRAINT "item_web_link_has_url" CHECK ("type" NOT IN ('web','link') OR "url" IS NOT NULL);
-- chuỗi rỗng / quá dài.
ALTER TABLE "item" ADD CONSTRAINT "item_title_nonblank" CHECK (btrim("title") <> '');
ALTER TABLE "topic" ADD CONSTRAINT "topic_name_nonblank" CHECK (btrim("name") <> '');
ALTER TABLE "tag" ADD CONSTRAINT "tag_name_nonblank" CHECK (btrim("name") <> '');
ALTER TABLE "user" ADD CONSTRAINT "user_username_format" CHECK ("username" ~ '^[a-z0-9._-]{3,64}$');
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_username_len" CHECK (char_length("username") <= 64);
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_ip_len" CHECK (char_length("ip") <= 64);
ALTER TABLE "note" ADD CONSTRAINT "note_current_version_positive" CHECK ("current_version" >= 1);
