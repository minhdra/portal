import { Prisma } from "../../../prisma/generated/client";
import { prisma, type Db, type Tx } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { isUuid, slugify } from "../lib/util";
import { audit } from "./audit";

export const MAX_DEPTH = 32; // giới hạn độ sâu khi duyệt cây (CTE) và độ sâu tối đa của cây

export interface TopicDto {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  itemCount: number;
  children: TopicDto[];
}

type Row = { id: string; parentId: string | null; name: string; slug: string; icon: string | null; sortOrder: number };
const toDto = (t: Row, itemCount = 0): TopicDto => ({
  id: t.id, parentId: t.parentId, name: t.name, slug: t.slug, icon: t.icon, sortOrder: t.sortOrder, itemCount, children: [],
});

/** Khoá tư vấn: tuần tự hoá mọi thay đổi cấu trúc cây để hai lần di chuyển song song không tạo chu trình. */
async function lockTree(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('portal.topic.tree'))`;
}

export async function listTopics(): Promise<TopicDto[]> {
  const [topics, counts] = await Promise.all([
    prisma.topic.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.item.groupBy({ by: ["topicId"], where: { status: "active", topicId: { not: null } }, _count: { _all: true } }),
  ]);
  const cnt = new Map(counts.map((c) => [c.topicId!, c._count._all]));
  const map = new Map(topics.map((t) => [t.id, toDto(t, cnt.get(t.id) ?? 0)]));
  const roots: TopicDto[] = [];
  for (const t of topics) {
    const d = map.get(t.id)!;
    const p = t.parentId ? map.get(t.parentId) : undefined;
    (p ? p.children : roots).push(d);
  }
  return roots;
}

export async function getTopic(id: string, db: Db = prisma): Promise<TopicDto> {
  if (!isUuid(id)) throw notFound("Không tìm thấy chủ đề.");
  const t = await db.topic.findUnique({ where: { id } });
  if (!t) throw notFound("Không tìm thấy chủ đề.");
  const n = await db.item.count({ where: { topicId: id, status: "active" } });
  return toDto(t, n);
}

async function uniqueSlug(tx: Tx, parentId: string | null, name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "muc";
  const rows = await tx.topic.findMany({
    where: { parentId, slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { slug: true },
  });
  const used = new Set(rows.map((r) => r.slug));
  if (!used.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const cand = `${base}-${i}`;
    if (!used.has(cand)) return cand;
  }
  throw conflict("Không tạo được slug duy nhất.");
}

/** Số tầng từ topic lên gốc (bao gồm chính nó), dừng ở MAX_DEPTH+1 để chặn dữ liệu hỏng. */
async function depthOf(tx: Tx, id: string): Promise<number> {
  const r = await tx.$queryRaw<{ n: number }[]>`
    WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT id, parent_id, 1 FROM topic WHERE id = ${id}::uuid
      UNION ALL
      SELECT t.id, t.parent_id, up.depth + 1 FROM topic t JOIN up ON t.id = up.parent_id WHERE up.depth <= ${MAX_DEPTH}
    ) SELECT COALESCE(MAX(depth), 0)::int AS n FROM up`;
  return r[0]?.n ?? 0;
}

/** Chiều cao cây con (1 = chỉ chính nó). */
async function subtreeHeight(tx: Tx, id: string): Promise<number> {
  const r = await tx.$queryRaw<{ n: number }[]>`
    WITH RECURSIVE down(id, depth) AS (
      SELECT id, 1 FROM topic WHERE id = ${id}::uuid
      UNION ALL
      SELECT t.id, down.depth + 1 FROM topic t JOIN down ON t.parent_id = down.id WHERE down.depth <= ${MAX_DEPTH}
    ) SELECT COALESCE(MAX(depth), 0)::int AS n FROM down`;
  return r[0]?.n ?? 0;
}

/** true nếu `candidateParent` là chính `id` hoặc là hậu duệ của `id` (đặt làm cha sẽ tạo chu trình). */
export async function wouldCreateCycle(tx: Tx, id: string, candidateParent: string): Promise<boolean> {
  const r = await tx.$queryRaw<{ hit: boolean }[]>`
    WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT id, parent_id, 1 FROM topic WHERE id = ${candidateParent}::uuid
      UNION ALL
      SELECT t.id, t.parent_id, up.depth + 1 FROM topic t JOIN up ON t.id = up.parent_id WHERE up.depth <= ${MAX_DEPTH}
    ) SELECT EXISTS (SELECT 1 FROM up WHERE id = ${id}::uuid) AS hit`;
  return r[0]?.hit === true;
}

async function assertDepth(tx: Tx, parentId: string | null, extraHeight: number) {
  if (!parentId) return;
  const d = await depthOf(tx, parentId);
  if (d + extraHeight > MAX_DEPTH) throw conflict(`Cây chủ đề quá sâu (tối đa ${MAX_DEPTH} tầng).`);
}

export async function createTopic(
  input: { parentId?: string | null; name: string; icon?: string | null },
  actorId: string,
  ip: string,
): Promise<TopicDto> {
  const parentId = input.parentId ?? null;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockTree(tx);
        if (parentId && !(await tx.topic.findUnique({ where: { id: parentId }, select: { id: true } }))) {
          throw invalid("Chủ đề cha không tồn tại.", { parentId: "Không tồn tại" });
        }
        await assertDepth(tx, parentId, 1);
        const slug = await uniqueSlug(tx, parentId, input.name);
        const max = await tx.topic.aggregate({ where: { parentId }, _max: { sortOrder: true } });
        const t = await tx.topic.create({
          data: { parentId, name: input.name, slug, icon: input.icon ?? null, sortOrder: (max._max.sortOrder ?? 0) + 10 },
        });
        await audit(actorId, "topic.create", "topic", t.id, { name: t.name }, ip, tx);
        return toDto(t);
      });
    } catch (e) {
      if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

export async function updateTopic(
  id: string,
  patch: { name?: string; icon?: string | null; parentId?: string | null },
  actorId: string,
  ip: string,
): Promise<TopicDto> {
  if (!isUuid(id)) throw notFound("Không tìm thấy chủ đề.");
  return prisma.$transaction(async (tx) => {
    await lockTree(tx);
    const cur = await tx.topic.findUnique({ where: { id } });
    if (!cur) throw notFound("Không tìm thấy chủ đề.");
    const data: Prisma.TopicUncheckedUpdateInput = {};
    const newParent = patch.parentId !== undefined ? patch.parentId : cur.parentId;
    const moving = patch.parentId !== undefined && patch.parentId !== cur.parentId;
    if (moving && newParent) {
      if (!(await tx.topic.findUnique({ where: { id: newParent }, select: { id: true } }))) {
        throw invalid("Chủ đề cha không tồn tại.", { parentId: "Không tồn tại" });
      }
      if (newParent === id || (await wouldCreateCycle(tx, id, newParent))) {
        throw conflict("Không thể chuyển chủ đề vào chính nó hoặc chủ đề con của nó (tạo chu trình).");
      }
      await assertDepth(tx, newParent, await subtreeHeight(tx, id));
    }
    const renaming = patch.name !== undefined && patch.name !== cur.name;
    if (renaming) data.name = patch.name;
    if (patch.icon !== undefined) data.icon = patch.icon;
    if (moving) {
      data.parentId = newParent;
      const max = await tx.topic.aggregate({ where: { parentId: newParent }, _max: { sortOrder: true } });
      data.sortOrder = (max._max.sortOrder ?? 0) + 10;
    }
    if (renaming || moving) data.slug = await uniqueSlug(tx, newParent, patch.name ?? cur.name, id);
    const t = Object.keys(data).length ? await tx.topic.update({ where: { id }, data }) : cur;
    await audit(actorId, "topic.update", "topic", id, { fields: Object.keys(patch) }, ip, tx);
    return getTopic(t.id, tx);
  });
}

export async function deleteTopic(id: string, actorId: string, ip: string): Promise<void> {
  if (!isUuid(id)) throw notFound("Không tìm thấy chủ đề.");
  await prisma.$transaction(async (tx) => {
    await lockTree(tx);
    const t = await tx.topic.findUnique({ where: { id } });
    if (!t) throw notFound("Không tìm thấy chủ đề.");
    const [items, kids] = await Promise.all([
      tx.item.count({ where: { topicId: id } }),
      tx.topic.count({ where: { parentId: id } }),
    ]);
    if (items > 0 || kids > 0) {
      throw conflict("Chủ đề còn mục hoặc chủ đề con. Hãy chuyển chúng đi trước khi xoá.", { items, children: kids } as never);
    }
    await tx.topic.delete({ where: { id } });
    await audit(actorId, "topic.delete", "topic", id, { name: t.name }, ip, tx);
  });
}

export async function reorderTopics(parentId: string | null, ids: string[], actorId: string, ip: string): Promise<void> {
  if (new Set(ids).size !== ids.length) throw invalid("Danh sách có mã trùng.", { ids: "Trùng lặp" });
  await prisma.$transaction(async (tx) => {
    await lockTree(tx);
    // ids phải là ĐÚNG tập chủ đề con của parentId: thiếu/thừa -> 422.
    const siblings = await tx.topic.findMany({ where: { parentId }, select: { id: true } });
    const have = new Set(siblings.map((r) => r.id));
    if (have.size !== ids.length || ids.some((id) => !have.has(id))) {
      throw invalid("Danh sách phải gồm đúng tất cả chủ đề cùng cha (không thiếu, không thừa).", { ids: "Không khớp tập chủ đề cùng cha" });
    }
    if (ids.length) {
      const orders = ids.map((_, i) => (i + 1) * 10);
      await tx.$executeRaw`
        UPDATE topic SET sort_order = v.ord, updated_at = now()
        FROM unnest(${ids}::uuid[], ${orders}::int[]) AS v(id, ord) WHERE topic.id = v.id`;
    }
    await audit(actorId, "topic.reorder", "topic", parentId, { count: ids.length }, ip, tx);
  });
}
