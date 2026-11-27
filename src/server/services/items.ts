import { Prisma } from "../../../prisma/generated/client";
import { prisma, type Db, type Tx } from "../db";
import { invalid, notFound } from "../errors";
import { isUuid, slugify } from "../lib/util";
import { audit } from "./audit";
import { removeBlobs } from "./storage";

type ItemType = "tool" | "web" | "doc" | "note" | "link";
type ItemStatus = "active" | "draft" | "archived";

const itemInclude = {
  tags: { include: { tag: true } },
  _count: { select: { files: true } },
} satisfies Prisma.ItemInclude;

type ItemRow = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

export interface ItemDto {
  id: string;
  type: ItemType;
  title: string;
  description: string | null;
  url: string | null;
  icon: string | null;
  status: ItemStatus;
  topicId: string | null;
  tags: { id: string; name: string; slug: string }[];
  pinned: boolean;
  sortOrder: number;
  fileCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date | null;
}

export function toItemDto(i: ItemRow): ItemDto {
  return {
    id: i.id, type: i.type, title: i.title, description: i.description, url: i.url, icon: i.icon, status: i.status,
    topicId: i.topicId,
    tags: i.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, slug: t.tag.slug })).sort((a, b) => a.name.localeCompare(b.name)),
    pinned: i.pinned, sortOrder: i.sortOrder, fileCount: i._count.files,
    createdAt: i.createdAt, updatedAt: i.updatedAt, lastOpenedAt: i.lastOpenedAt,
  };
}

export async function getItem(id: string, db: Db = prisma): Promise<ItemDto> {
  if (!isUuid(id)) throw notFound("Không tìm thấy mục.");
  const i = await db.item.findUnique({ where: { id }, include: itemInclude });
  if (!i) throw notFound("Không tìm thấy mục.");
  return toItemDto(i);
}

/** Bảo đảm item tồn tại (dùng cho route con). */
export async function requireItem(id: string, db: Db = prisma) {
  if (!isUuid(id)) throw notFound("Không tìm thấy mục.");
  const i = await db.item.findUnique({ where: { id }, select: { id: true, type: true, title: true, status: true } });
  if (!i) throw notFound("Không tìm thấy mục.");
  return i;
}

// ---------- tag ----------

async function setTags(tx: Tx, itemId: string, names: string[]): Promise<void> {
  const bySlug = new Map<string, string>();
  for (const n of names) {
    const name = n.trim();
    const slug = slugify(name);
    if (!slug) throw invalid(`Nhãn "${name}" không hợp lệ.`, { tags: "Nhãn phải có chữ hoặc số" });
    if (!bySlug.has(slug)) bySlug.set(slug, name);
  }
  const slugs = [...bySlug.keys()];
  if (slugs.length) {
    await tx.tag.createMany({ data: slugs.map((slug) => ({ slug, name: bySlug.get(slug)! })), skipDuplicates: true });
  }
  const tags = slugs.length ? await tx.tag.findMany({ where: { slug: { in: slugs } }, select: { id: true } }) : [];
  await tx.itemTag.deleteMany({ where: { itemId, tagId: { notIn: tags.map((t) => t.id) } } });
  if (tags.length) await tx.itemTag.createMany({ data: tags.map((t) => ({ itemId, tagId: t.id })), skipDuplicates: true });
}

export async function listTags() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { items: { where: { item: { status: "active" } } } } } },
  });
  return tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug, count: t._count.items }));
}

// ---------- ghi ----------

export interface ItemInput {
  type: ItemType;
  title: string;
  description?: string | null;
  url?: string | null;
  icon?: string | null;
  topicId?: string | null;
  tags?: string[];
}

async function assertTopic(tx: Tx, topicId: string | null | undefined) {
  if (topicId && !(await tx.topic.findUnique({ where: { id: topicId }, select: { id: true } }))) {
    throw invalid("Chủ đề không tồn tại.", { topicId: "Không tồn tại" });
  }
}

function assertUrlRule(type: ItemType, url: string | null) {
  if ((type === "web" || type === "link") && !url) {
    throw invalid("Loại web/link bắt buộc có URL.", { url: "Bắt buộc với loại web/link" });
  }
}

async function nextSort(tx: Tx, topicId: string | null): Promise<number> {
  const m = await tx.item.aggregate({ where: { topicId }, _max: { sortOrder: true } });
  return (m._max.sortOrder ?? 0) + 10;
}

/**
 * Tạo note (v1) nếu item loại note chưa có. Trả note. INSERT ... ON CONFLICT DO NOTHING (không ném lỗi, không làm
 * hỏng giao dịch khi hai request cùng tạo), rồi SELECT. Chỉ ghi khi note chưa tồn tại.
 */
export async function ensureNote(tx: Tx, itemId: string, authorId: string | null) {
  const existing = await tx.note.findUnique({ where: { itemId } });
  if (existing) return existing;
  const ins = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO note (item_id, body_md, current_version, updated_at) VALUES (${itemId}::uuid, '', 1, now())
    ON CONFLICT (item_id) DO NOTHING RETURNING id`;
  const note = await tx.note.findUniqueOrThrow({ where: { itemId } });
  if (ins.length > 0) await tx.noteVersion.create({ data: { noteId: note.id, version: 1, bodyMd: "", createdById: authorId } });
  return note;
}

export async function createItem(input: ItemInput, actorId: string, ip: string): Promise<ItemDto> {
  assertUrlRule(input.type, input.url ?? null);
  return prisma.$transaction(async (tx) => {
    await assertTopic(tx, input.topicId);
    const topicId = input.topicId ?? null;
    const item = await tx.item.create({
      data: {
        type: input.type, title: input.title, description: input.description || null, url: input.url ?? null,
        icon: input.icon || null, topicId, sortOrder: await nextSort(tx, topicId), createdById: actorId,
      },
    });
    if (input.tags?.length) await setTags(tx, item.id, input.tags);
    if (input.type === "note") await ensureNote(tx, item.id, actorId);
    await audit(actorId, "item.create", "item", item.id, { type: item.type, title: item.title }, ip, tx);
    return getItem(item.id, tx);
  });
}

export interface ItemPatch extends Partial<ItemInput> {
  status?: ItemStatus;
  pinned?: boolean;
}

export async function updateItem(id: string, p: ItemPatch, actorId: string, ip: string): Promise<ItemDto> {
  if (!isUuid(id)) throw notFound("Không tìm thấy mục.");
  return prisma.$transaction(async (tx) => {
    const cur = await tx.item.findUnique({ where: { id } });
    if (!cur) throw notFound("Không tìm thấy mục.");
    const type = p.type ?? cur.type;
    const url = p.url !== undefined ? p.url : cur.url;
    assertUrlRule(type, url);
    const data: Prisma.ItemUncheckedUpdateInput = {};
    if (p.type !== undefined) data.type = p.type;
    if (p.title !== undefined) data.title = p.title;
    if (p.description !== undefined) data.description = p.description || null;
    if (p.url !== undefined) data.url = p.url;
    if (p.icon !== undefined) data.icon = p.icon || null;
    if (p.status !== undefined) data.status = p.status;
    if (p.pinned !== undefined) data.pinned = p.pinned;
    if (p.topicId !== undefined && p.topicId !== cur.topicId) {
      await assertTopic(tx, p.topicId);
      data.topicId = p.topicId;
      data.sortOrder = await nextSort(tx, p.topicId);
    }
    if (Object.keys(data).length) await tx.item.update({ where: { id }, data });
    else await tx.item.update({ where: { id }, data: { updatedAt: new Date() } });
    if (p.tags !== undefined) await setTags(tx, id, p.tags);
    if (type === "note") await ensureNote(tx, id, actorId);
    await audit(actorId, "item.update", "item", id, { fields: Object.keys(p) }, ip, tx);
    return getItem(id, tx);
  });
}

export async function archiveItem(id: string, actorId: string, ip: string): Promise<void> {
  if (!isUuid(id)) throw notFound("Không tìm thấy mục.");
  await prisma.$transaction(async (tx) => {
    const r = await tx.item.updateMany({ where: { id }, data: { status: "archived" } });
    if (r.count === 0) throw notFound("Không tìm thấy mục.");
    await audit(actorId, "item.archive", "item", id, null, ip, tx);
  });
}

/** Xoá cứng: xoá hàng (cascade file/note/tag) rồi xoá blob trên đĩa. */
export async function hardDeleteItem(id: string, actorId: string, ip: string): Promise<void> {
  if (!isUuid(id)) throw notFound("Không tìm thấy mục.");
  const keys = await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({ where: { id }, include: { files: { select: { storageKey: true } } } });
    if (!item) throw notFound("Không tìm thấy mục.");
    await tx.item.delete({ where: { id } });
    await audit(actorId, "item.delete", "item", id, { title: item.title, files: item.files.length }, ip, tx);
    return item.files.map((f) => f.storageKey);
  });
  await removeBlobs(keys);
}

export async function markOpened(id: string): Promise<void> {
  if (!isUuid(id)) throw notFound("Không tìm thấy mục.");
  const r = await prisma.item.updateMany({ where: { id }, data: { lastOpenedAt: new Date() } });
  if (r.count === 0) throw notFound("Không tìm thấy mục.");
}

export async function reorderItems(topicId: string | null, ids: string[], actorId: string, ip: string): Promise<void> {
  if (new Set(ids).size !== ids.length) throw invalid("Danh sách có mã trùng.", { ids: "Trùng lặp" });
  await prisma.$transaction(async (tx) => {
    // ids phải là ĐÚNG tập mục (chưa lưu trữ) của chủ đề: thiếu/thừa -> 422, tránh thứ tự lệch âm thầm.
    const siblings = await tx.item.findMany({ where: { topicId, status: { not: "archived" } }, select: { id: true } });
    const have = new Set(siblings.map((r) => r.id));
    if (have.size !== ids.length || ids.some((id) => !have.has(id))) {
      throw invalid("Danh sách phải gồm đúng tất cả mục của chủ đề này (không thiếu, không thừa).", { ids: "Không khớp tập mục của chủ đề" });
    }
    if (ids.length) {
      const orders = ids.map((_, i) => (i + 1) * 10);
      await tx.$executeRaw`
        UPDATE item SET sort_order = v.ord, updated_at = now()
        FROM unnest(${ids}::uuid[], ${orders}::int[]) AS v(id, ord) WHERE item.id = v.id`;
    }
    await audit(actorId, "item.reorder", "topic", topicId, { count: ids.length }, ip, tx);
  });
}

// ---------- đọc / tìm ----------

/** "ha noi" -> `ha:* & noi:*` (chỉ chữ/số Unicode, tối đa 8 từ) cho to_tsquery('simple', f_unaccent(...)). */
export function buildPrefixQuery(q: string): string | null {
  const tokens = q.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8).map((t) => t.slice(0, 50));
  return tokens.length ? tokens.map((t) => `${t}:*`).join(" & ") : null;
}

export interface ListParams {
  topic?: string; // uuid | "none"
  q?: string;
  tag?: string;
  type?: ItemType;
  status?: ItemStatus | "all";
  pinned?: boolean;
  recent?: boolean;
  limit: number;
  cursor?: string;
}

const decodeCursor = (c?: string): number => {
  if (!c) return 0;
  try {
    const n = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as { o?: unknown };
    if (typeof n.o === "number" && Number.isInteger(n.o) && n.o >= 0 && n.o <= 1_000_000) return n.o;
  } catch {
    /* rơi xuống lỗi */
  }
  throw invalid("cursor không hợp lệ.", { cursor: "Không hợp lệ" });
};
const encodeCursor = (o: number) => Buffer.from(JSON.stringify({ o })).toString("base64url");

export async function listItems(p: ListParams): Promise<{ items: ItemDto[]; nextCursor: string | null }> {
  const offset = decodeCursor(p.cursor);
  const S = Prisma.sql;
  const where: Prisma.Sql[] = [];
  const status = p.status ?? "active";
  if (status !== "all") where.push(S`i.status = ${status}::item_status`);
  if (p.type) where.push(S`i.type = ${p.type}::item_type`);
  if (p.pinned) where.push(S`i.pinned`);
  if (p.recent) where.push(S`i.last_opened_at IS NOT NULL`);
  if (p.topic === "none") where.push(S`i.topic_id IS NULL`);
  else if (p.topic) {
    where.push(S`i.topic_id IN (
      WITH RECURSIVE sub(id, depth) AS (
        SELECT id, 1 FROM topic WHERE id = ${p.topic}::uuid
        UNION ALL SELECT t.id, sub.depth + 1 FROM topic t JOIN sub ON t.parent_id = sub.id WHERE sub.depth < 32
      ) SELECT id FROM sub)`);
  }
  if (p.tag) {
    where.push(S`EXISTS (SELECT 1 FROM item_tag it JOIN tag tg ON tg.id = it.tag_id WHERE it.item_id = i.id AND tg.slug = ${p.tag})`);
  }
  const tsq = p.q ? buildPrefixQuery(p.q) : null;
  if (p.q && !tsq) return { items: [], nextCursor: null };
  if (tsq) where.push(S`i.search @@ to_tsquery('simple', f_unaccent(${tsq}))`);

  const order = tsq
    ? S`ts_rank(i.search, to_tsquery('simple', f_unaccent(${tsq}))) DESC, i.pinned DESC, i.updated_at DESC, i.id`
    : p.recent
      ? S`i.last_opened_at DESC, i.id`
      : S`i.pinned DESC, i.sort_order ASC, i.created_at DESC, i.id`;
  const whereSql = where.length ? S`WHERE ${Prisma.join(where, " AND ")}` : S``;
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    S`SELECT i.id FROM item i ${whereSql} ORDER BY ${order} LIMIT ${p.limit + 1} OFFSET ${offset}`,
  );
  const hasMore = rows.length > p.limit;
  const ids = rows.slice(0, p.limit).map((r) => r.id);
  const found = await prisma.item.findMany({ where: { id: { in: ids } }, include: itemInclude });
  const byId = new Map(found.map((i) => [i.id, i]));
  const items = ids.flatMap((id) => (byId.has(id) ? [toItemDto(byId.get(id)!)] : []));
  return { items, nextCursor: hasMore ? encodeCursor(offset + p.limit) : null };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function search(q: string) {
  const tsq = buildPrefixQuery(q);
  if (!tsq) return { items: [] as ItemDto[], topics: [] };
  const S = Prisma.sql;
  const ids = await prisma.$queryRaw<{ id: string }[]>(S`
    SELECT i.id FROM item i
    LEFT JOIN note n ON n.item_id = i.id
    WHERE i.status = 'active'
      AND (i.search @@ to_tsquery('simple', f_unaccent(${tsq})) OR n.search @@ to_tsquery('simple', f_unaccent(${tsq})))
    ORDER BY GREATEST(ts_rank(i.search, to_tsquery('simple', f_unaccent(${tsq}))), ts_rank(COALESCE(n.search, ''::tsvector), to_tsquery('simple', f_unaccent(${tsq})))) DESC, i.id
    LIMIT 20`);
  const found = await prisma.item.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: itemInclude });
  const byId = new Map(found.map((i) => [i.id, i]));
  const items = ids.flatMap((r) => (byId.has(r.id) ? [toItemDto(byId.get(r.id)!)] : []));
  const like = `%${escapeLike(q.trim().slice(0, 100))}%`;
  const topics = await prisma.$queryRaw<{ id: string; parentId: string | null; name: string; slug: string; icon: string | null }[]>(S`
    SELECT id, parent_id AS "parentId", name, slug, icon FROM topic
    WHERE lower(f_unaccent(name)) LIKE lower(f_unaccent(${like})) ESCAPE '\\'
    ORDER BY sort_order, name LIMIT 20`);
  return { items, topics };
}

