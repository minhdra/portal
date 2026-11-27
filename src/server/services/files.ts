import { fileTypeFromBuffer } from "file-type";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { Prisma } from "../../../prisma/generated/client";
import { prisma } from "../db";
import { MAX_UPLOAD_BYTES } from "../env";
import { ApiError, invalid, notFound } from "../errors";
import { isUuid, sha256Hex, truncateCp } from "../lib/util";
import { audit } from "./audit";
import { requireItem } from "./items";
import { newStorageKey, removeBlobs, resolveKey, writeBlob } from "./storage";

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const MAGIC_ALLOWED = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", DOCX, XLSX, PPTX,
]);
const TEXT_BY_EXT: Record<string, string> = { txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv" };
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv"]);

export const isInline = (mime: string) => INLINE.has(mime);

/** Bỏ đường dẫn, ký tự điều khiển/bidi; giữ phần mở rộng; tối đa 200 ký tự. */
export function sanitizeFilename(raw: string): string {
  let n = raw.normalize("NFC");
  n = n.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  n = n.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069"<>:|?*]/g, "").replace(/^[.\s]+/, "").trim();
  if (n.length > 200) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : "";
    n = truncateCp(n.slice(0, dot > 0 && ext ? dot : n.length), 200 - ext.length) + ext;
  }
  return n || "file";
}

/** Xác định mime từ nội dung. Trả null nếu loại không được phép. */
export async function detectMime(buf: Uint8Array, name: string): Promise<string | null> {
  const ft = await fileTypeFromBuffer(buf);
  if (ft) return MAGIC_ALLOWED.has(ft.mime) ? ft.mime : null;
  // Không có magic bytes: chỉ nhận văn bản thuần theo đuôi, phải là UTF-8 hợp lệ và không có NUL.
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const mime = TEXT_BY_EXT[ext];
  if (!mime) return null;
  if (buf.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
  return mime;
}

export interface FileDto {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: Date;
}

type FileRow = { id: string; originalName: string; mime: string; size: bigint; sha256: string; createdAt: Date };
export const toFileDto = (f: FileRow): FileDto => ({
  id: f.id, originalName: f.originalName, mime: f.mime, size: Number(f.size), sha256: f.sha256, createdAt: f.createdAt,
});

export async function listFiles(itemId: string): Promise<FileDto[]> {
  await requireItem(itemId);
  const rows = await prisma.file.findMany({ where: { itemId }, orderBy: { createdAt: "asc" } });
  return rows.map(toFileDto);
}

export async function saveUploads(
  itemId: string,
  files: { name: string; data: Uint8Array }[],
  actorId: string,
  ip: string,
): Promise<(FileDto & { duplicate?: boolean })[]> {
  await requireItem(itemId);
  // Pha 1: kiểm tra TOÀN BỘ lô (rỗng/size/mime) trước khi ghi bất kỳ blob nào: một tệp hỏng không để lại tệp mồ côi.
  const prepared: { data: Uint8Array; name: string; mime: string; sha256: string }[] = [];
  for (const f of files) {
    if (f.data.byteLength === 0) throw invalid(`Tệp "${f.name}" rỗng.`, { file: "Tệp rỗng" });
    if (f.data.byteLength > MAX_UPLOAD_BYTES) throw new ApiError("payload_too_large", `Tệp "${f.name}" vượt quá 50 MB.`);
    const name = sanitizeFilename(f.name);
    const mime = await detectMime(f.data, name);
    if (!mime) throw new ApiError("unsupported_media_type", `Loại tệp "${name}" không được hỗ trợ.`);
    prepared.push({ data: f.data, name, mime, sha256: sha256Hex(f.data) });
  }
  // Pha 2: ghi.
  const out: (FileDto & { duplicate?: boolean })[] = [];
  for (const { data, name, mime, sha256 } of prepared) {
    const dup = await prisma.file.findFirst({ where: { itemId, sha256 } });
    if (dup) {
      out.push({ ...toFileDto(dup), duplicate: true });
      continue;
    }
    const storageKey = newStorageKey();
    await writeBlob(storageKey, data);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const r = await tx.file.create({
          data: { itemId, storageKey, originalName: name, mime, size: BigInt(data.byteLength), sha256, uploadedById: actorId },
        });
        await audit(actorId, "file.upload", "file", r.id, { itemId, name, mime, size: data.byteLength }, ip, tx);
        return r;
      });
      out.push(toFileDto(row));
    } catch (e) {
      await removeBlobs([storageKey]);
      // Đua với upload cùng nội dung: unique (item_id, sha256) -> trả bản đã có như trường hợp trùng thường.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await prisma.file.findFirst({ where: { itemId, sha256 } });
        if (existing) {
          out.push({ ...toFileDto(existing), duplicate: true });
          continue;
        }
      }
      throw e;
    }
  }
  return out;
}

export async function getFile(id: string) {
  if (!isUuid(id)) throw notFound("Không tìm thấy tệp.");
  const f = await prisma.file.findUnique({ where: { id } });
  if (!f) throw notFound("Không tìm thấy tệp.");
  return f;
}

export async function deleteFile(id: string, actorId: string, ip: string): Promise<void> {
  const f = await getFile(id);
  await prisma.$transaction(async (tx) => {
    await tx.file.delete({ where: { id } });
    await audit(actorId, "file.delete", "file", id, { itemId: f.itemId, name: f.originalName }, ip, tx);
  });
  // storage_key là duy nhất; chỉ xoá blob khi không còn hàng nào tham chiếu.
  if ((await prisma.file.count({ where: { storageKey: f.storageKey } })) === 0) await removeBlobs([f.storageKey]);
}

// ---------- Range ----------

export type RangeResult = { start: number; end: number } | "full" | "invalid";

export function parseRange(header: string | null, size: number): RangeResult {
  if (!header) return "full";
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "full"; // nhiều khoảng hoặc cú pháp lạ: bỏ qua Range, trả toàn bộ (RFC 9110)
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const n = Number(b);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isSafeInteger(start) || start >= size || end < start) return "invalid";
  return { start, end };
}

function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

export const FILE_CSP = {
  pdf: "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
  other: "sandbox; frame-ancestors 'self'",
} as const;

export async function serveFile(req: Request, id: string, forceDownload: boolean): Promise<Response> {
  const f = await getFile(id);
  const full = resolveKey(f.storageKey);
  let size: number;
  try {
    size = (await fs.stat(full)).size;
  } catch {
    throw notFound("Nội dung tệp không còn trên máy chủ.");
  }
  const inline = !forceDownload && isInline(f.mime);
  const headers = new Headers({
    "Content-Type": f.mime.startsWith("text/") ? `${f.mime}; charset=utf-8` : f.mime,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", f.originalName),
    "X-Content-Type-Options": "nosniff",
    // Trình xem PDF của Chrome không chạy trong sandbox CSP; PDF không phải HTML nên dùng default-src 'none'.
    // frame-ancestors 'self': trang portal nhúng được tệp trong iframe cùng origin (CSP ở đây là CSP DUY NHẤT: next.config
    // không đặt CSP cho /api/files vì sẽ ghi đè header này). Xem docs/adr/0003-security-hardening.md.
    "Content-Security-Policy": FILE_CSP[f.mime === "application/pdf" ? "pdf" : "other"],
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Accept-Ranges": "bytes",
    ETag: `"${f.sha256}"`,
  });
  if (req.headers.get("if-none-match") === headers.get("ETag")) return new Response(null, { status: 304, headers });

  const r = parseRange(req.headers.get("range"), size);
  if (r === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const [start, end, status] = r === "full" ? [0, size - 1, 200] : [r.start, r.end, 206];
  headers.set("Content-Length", String(size === 0 ? 0 : end - start + 1));
  if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  if (req.method === "HEAD" || size === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(full, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}
