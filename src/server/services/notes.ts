import { Prisma } from "../../../prisma/generated/client";
import { prisma, type Tx } from "../db";
import { conflict, notFound } from "../errors";
import { isUuid } from "../lib/util";
import { audit } from "./audit";
import { ensureNote } from "./items";

export const MAX_NOTE_CHARS = 1_000_000;
/** Giữ tối đa chừng này phiên bản mỗi note; vượt thì xoá bản cũ nhất (ADR 0003). */
export const MAX_NOTE_VERSIONS = 200;

async function noteItem(tx: Tx, itemId: string) {
  if (!isUuid(itemId)) throw notFound("Không tìm thấy ghi chú.");
  const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true, type: true, title: true } });
  if (!item || item.type !== "note") throw notFound("Không tìm thấy ghi chú.");
  return item;
}

export async function getNote(itemId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await noteItem(tx, itemId);
    const n = await ensureNote(tx, itemId, actorId);
    return { markdown: n.bodyMd, version: n.currentVersion, updatedAt: n.updatedAt };
  });
}

/**
 * Ghi phiên bản mới trong 1 transaction. UPDATE ... WHERE current_version = base là bước tuần tự hoá:
 * hai người ghi cùng baseVersion thì chỉ một người thắng, người kia nhận 409.
 */
async function writeVersion(tx: Tx, itemId: string, markdown: string, baseVersion: number | null, actorId: string) {
  await noteItem(tx, itemId);
  const note = await ensureNote(tx, itemId, actorId);
  const rows = await tx.$queryRaw<{ id: string; current_version: number }[]>`
    UPDATE note SET body_md = ${markdown}, current_version = current_version + 1, updated_at = now()
    WHERE id = ${note.id}::uuid ${baseVersion === null ? Prisma.empty : Prisma.sql`AND current_version = ${baseVersion}`}
    RETURNING id, current_version`;
  if (rows.length === 0) {
    const cur = await tx.note.findUnique({ where: { id: note.id }, select: { currentVersion: true } });
    throw conflict("Ghi chú đã được sửa ở nơi khác. Hãy tải lại bản mới nhất.", { currentVersion: cur?.currentVersion } as never);
  }
  const version = rows[0]!.current_version;
  await tx.noteVersion.create({ data: { noteId: note.id, version, bodyMd: markdown, createdById: actorId } });
  // Cắt lịch sử: giữ MAX_NOTE_VERSIONS bản mới nhất (version tăng đơn điệu nên so với version hiện tại).
  await tx.noteVersion.deleteMany({ where: { noteId: note.id, version: { lte: version - MAX_NOTE_VERSIONS } } });
  return version;
}

export async function putNote(itemId: string, markdown: string, baseVersion: number, actorId: string, ip: string) {
  return prisma.$transaction(async (tx) => {
    const version = await writeVersion(tx, itemId, markdown, baseVersion, actorId);
    await audit(actorId, "note.update", "item", itemId, { version }, ip, tx);
    return { version };
  });
}

export async function listVersions(itemId: string) {
  return prisma.$transaction(async (tx) => {
    await noteItem(tx, itemId);
    const note = await ensureNote(tx, itemId, null);
    const rows = await tx.$queryRaw<{ version: number; created_at: Date; author: string | null; size: number }[]>`
      SELECT v.version, v.created_at, COALESCE(u.display_name, u.username) AS author, octet_length(v.body_md)::int AS size
      FROM note_version v LEFT JOIN "user" u ON u.id = v.created_by_id
      WHERE v.note_id = ${note.id}::uuid ORDER BY v.version DESC`;
    return { versions: rows.map((r) => ({ version: r.version, createdAt: r.created_at, author: r.author, size: r.size })) };
  });
}

export async function getVersion(itemId: string, v: number) {
  return prisma.$transaction(async (tx) => {
    await noteItem(tx, itemId);
    const note = await ensureNote(tx, itemId, null);
    const row = await tx.noteVersion.findUnique({
      where: { noteId_version: { noteId: note.id, version: v } },
      include: { createdBy: { select: { username: true, displayName: true } } },
    });
    if (!row) throw notFound("Không có phiên bản này.");
    return {
      version: row.version, createdAt: row.createdAt, markdown: row.bodyMd,
      author: row.createdBy ? (row.createdBy.displayName ?? row.createdBy.username) : null,
    };
  });
}

export async function restoreVersion(itemId: string, v: number, actorId: string, ip: string) {
  return prisma.$transaction(async (tx) => {
    await noteItem(tx, itemId);
    const note = await ensureNote(tx, itemId, actorId);
    const old = await tx.noteVersion.findUnique({ where: { noteId_version: { noteId: note.id, version: v } } });
    if (!old) throw notFound("Không có phiên bản này.");
    const version = await writeVersion(tx, itemId, old.bodyMd, null, actorId);
    await audit(actorId, "note.restore", "item", itemId, { from: v, version }, ip, tx);
    return { version };
  });
}

export async function exportNote(itemId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const item = await noteItem(tx, itemId);
    const n = await ensureNote(tx, itemId, actorId);
    return { title: item.title, markdown: n.bodyMd };
  });
}
