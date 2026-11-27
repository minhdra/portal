import fs from "node:fs/promises";
import mammoth from "mammoth";
import readXlsx from "read-excel-file/node";
import sanitizeHtml from "sanitize-html";
import { ApiError } from "../errors";
import { DOCX, XLSX, getFile } from "./files";
import { resolveKey } from "./storage";

export const VIEW_MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_COLS = 500;
const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED = 200 * 1024 * 1024;

/** Chặn zip bomb: đọc central directory, cộng kích thước giải nén khai báo. */
export function assertZipSane(buf: Uint8Array): void {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ApiError("unsupported_media_type", "Tệp không phải gói Office hợp lệ.");
  const total = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  if (total > MAX_ZIP_ENTRIES) throw new ApiError("payload_too_large", "Tệp có quá nhiều thành phần để xem.");
  let sum = 0;
  for (let n = 0; n < total; n++) {
    if (off + 46 > b.length || b.readUInt32LE(off) !== 0x02014b50) throw new ApiError("unsupported_media_type", "Tệp Office bị hỏng.");
    sum += b.readUInt32LE(off + 24);
    if (sum > MAX_ZIP_UNCOMPRESSED) throw new ApiError("payload_too_large", "Tệp giải nén quá lớn để xem.");
    off += 46 + b.readUInt16LE(off + 28) + b.readUInt16LE(off + 30) + b.readUInt16LE(off + 32);
  }
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "b", "i", "u", "s", "sub", "sup",
    "blockquote", "pre", "code", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "a", "img", "span",
  ],
  allowedAttributes: { a: ["href", "title"], img: ["src", "alt"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["data"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" } }),
  },
  exclusiveFilter: (f) => f.tag === "img" && !/^data:image\/(png|jpe?g|gif);base64,/i.test(f.attribs.src ?? ""),
};
// 'rel'/'target' do transformTags thêm vào: cho phép sau khi biến đổi.
SANITIZE.allowedAttributes = { ...(SANITIZE.allowedAttributes as object), a: ["href", "title", "rel", "target"] };

export const sanitizeDocHtml = (html: string): string => sanitizeHtml(html, SANITIZE);

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().replace(/T00:00:00\.000Z$/, "").replace(".000Z", "Z");
  return String(v).slice(0, 2000);
}

export async function viewFile(id: string) {
  const f = await getFile(id);
  if (f.mime !== DOCX && f.mime !== XLSX) throw new ApiError("unsupported_media_type", "Không hỗ trợ xem loại tệp này.");
  if (Number(f.size) > VIEW_MAX_BYTES) throw new ApiError("payload_too_large", "Tệp quá lớn để xem trong trang (tối đa 20 MB).");
  let buf: Buffer;
  try {
    buf = await fs.readFile(resolveKey(f.storageKey));
  } catch {
    throw new ApiError("not_found", "Nội dung tệp không còn trên máy chủ.");
  }
  assertZipSane(buf);

  if (f.mime === DOCX) {
    try {
      const r = await mammoth.convertToHtml({ buffer: buf });
      return { kind: "html" as const, html: sanitizeDocHtml(r.value) };
    } catch {
      throw new ApiError("unsupported_media_type", "Không đọc được tệp Word này.");
    }
  }
  try {
    const sheets = await readXlsx(buf);
    return {
      kind: "sheets" as const,
      sheets: sheets.map((s) => {
        const data = s.data as unknown[][];
        const width = data.reduce((m, r) => Math.max(m, r.length), 0);
        const truncated = data.length > MAX_ROWS || width > MAX_COLS;
        return {
          name: String(s.sheet).slice(0, 100),
          rows: data.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map(cellToString)),
          truncated,
        };
      }),
    };
  } catch {
    throw new ApiError("unsupported_media_type", "Không đọc được tệp Excel này.");
  }
}
