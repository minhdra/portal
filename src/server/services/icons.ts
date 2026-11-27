import { fileTypeFromBuffer } from "file-type";
import { prisma } from "../db";
import { ApiError, invalid, notFound } from "../errors";
import { isUuid } from "../lib/util";
import { readBodyLimited } from "../http";
import { audit } from "./audit";

/** Ảnh biểu tượng lưu trong Postgres (ADR 0004). Trần 64 KB sau khi client thu nhỏ; CHECK cùng giá trị trong migration. */
export const ICON_MAX_BYTES = 64 * 1024;
export const ICON_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const ALLOWED = new Set<string>(ICON_MIMES);
/** Phần dư cho viền multipart (boundary, tên trường, tên tệp). */
const MULTIPART_SLACK = 16 * 1024;

export const ICON_CSP = "default-src 'none'; sandbox; frame-ancestors 'self'";

export type IconKind = "item" | "topic";
const LABEL: Record<IconKind, string> = { item: "mục", topic: "chủ đề" };

/** URL ảnh kèm `?v=` (cache bust); null nếu không có ảnh. */
export function iconUrl(kind: IconKind, id: string, updatedAt: Date | null | undefined): string | null {
  return updatedAt ? `/api/${kind}s/${id}/icon?v=${updatedAt.getTime()}` : null;
}

/** Mime theo MAGIC BYTES (không tin Content-Type/tên tệp); null nếu không phải png/jpeg/webp/gif. SVG/HTML luôn bị loại. */
export async function detectIconMime(buf: Uint8Array): Promise<string | null> {
  const ft = await fileTypeFromBuffer(buf);
  return ft && ALLOWED.has(ft.mime) ? ft.mime : null;
}

/** Đọc thân PUT: ảnh thô hoặc multipart (trường `file`). Quá lớn -> 413 (đo khi đọc luồng), rỗng -> 422. */
export async function readIconBody(req: Request): Promise<Uint8Array> {
  const ct = req.headers.get("content-type") ?? "";
  if (/^multipart\/form-data;/i.test(ct)) {
    const buf = await readBodyLimited(req, ICON_MAX_BYTES + MULTIPART_SLACK);
    let form: FormData;
    try {
      form = await new Response(buf as BodyInit, { headers: { "content-type": ct } }).formData();
    } catch {
      throw invalid("Không đọc được dữ liệu multipart.");
    }
    const f = form.get("file");
    if (f === null || typeof f === "string") throw invalid("Thiếu trường file.", { file: "Bắt buộc" });
    if (f.size > ICON_MAX_BYTES) throw new ApiError("payload_too_large", "Ảnh biểu tượng tối đa 64 KB.");
    return new Uint8Array(await f.arrayBuffer());
  }
  return readBodyLimited(req, ICON_MAX_BYTES);
}

async function exists(kind: IconKind, id: string): Promise<void> {
  if (!isUuid(id)) throw notFound(`Không tìm thấy ${LABEL[kind]}.`);
  const where = { id };
  const row = kind === "item"
    ? await prisma.item.findUnique({ where, select: { id: true } })
    : await prisma.topic.findUnique({ where, select: { id: true } });
  if (!row) throw notFound(`Không tìm thấy ${LABEL[kind]}.`);
}

export async function setIcon(kind: IconKind, id: string, data: Uint8Array, actorId: string, ip: string): Promise<void> {
  await exists(kind, id);
  if (data.byteLength === 0) throw invalid("Ảnh rỗng.", { file: "Ảnh rỗng" });
  if (data.byteLength > ICON_MAX_BYTES) throw new ApiError("payload_too_large", "Ảnh biểu tượng tối đa 64 KB.");
  const mime = await detectIconMime(data);
  if (!mime) throw new ApiError("unsupported_media_type", "Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF.");
  const patch = { iconImage: Buffer.from(data), iconMime: mime, iconUpdatedAt: new Date() };
  await prisma.$transaction(async (tx) => {
    // updateMany: nếu hàng bị xoá giữa chừng thì count = 0 -> 404 thay vì ném P2025.
    const r = kind === "item"
      ? await tx.item.updateMany({ where: { id }, data: patch })
      : await tx.topic.updateMany({ where: { id }, data: patch });
    if (r.count === 0) throw notFound(`Không tìm thấy ${LABEL[kind]}.`);
    await audit(actorId, `${kind}.icon_set`, kind, id, { mime, size: data.byteLength }, ip, tx);
  });
}

export async function clearIcon(kind: IconKind, id: string, actorId: string, ip: string): Promise<void> {
  await exists(kind, id);
  const patch = { iconImage: null, iconMime: null, iconUpdatedAt: null };
  await prisma.$transaction(async (tx) => {
    const r = kind === "item"
      ? await tx.item.updateMany({ where: { id }, data: patch })
      : await tx.topic.updateMany({ where: { id }, data: patch });
    if (r.count === 0) throw notFound(`Không tìm thấy ${LABEL[kind]}.`);
    await audit(actorId, `${kind}.icon_clear`, kind, id, null, ip, tx);
  });
}

export async function serveIcon(req: Request, kind: IconKind, id: string): Promise<Response> {
  if (!isUuid(id)) throw notFound("Không có ảnh biểu tượng.");
  const select = { iconImage: true, iconMime: true, iconUpdatedAt: true } as const;
  const row = kind === "item"
    ? await prisma.item.findUnique({ where: { id }, select })
    : await prisma.topic.findUnique({ where: { id }, select });
  if (!row?.iconImage || !row.iconMime || !row.iconUpdatedAt) throw notFound("Không có ảnh biểu tượng.");
  const etag = `"icon-${row.iconUpdatedAt.getTime()}"`;
  const headers = new Headers({
    "Content-Type": row.iconMime,
    "X-Content-Type-Options": "nosniff",
    // Ảnh bất biến theo ?v=<iconUpdatedAt>; "private": chỉ cache trình duyệt, không cache dùng chung.
    "Cache-Control": "private, max-age=86400, immutable",
    // CSP là CSP DUY NHẤT của route (next.config không đặt CSP cho đường dẫn này, xem ADR 0003/0004).
    "Content-Security-Policy": ICON_CSP,
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: etag,
  });
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  headers.set("Content-Length", String(row.iconImage.byteLength));
  return new Response(req.method === "HEAD" ? null : (new Uint8Array(row.iconImage) as BodyInit), { status: 200, headers });
}
