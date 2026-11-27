import fs from "node:fs/promises";
import { Worker } from "node:worker_threads";
import mammoth from "mammoth";
import readXlsx from "read-excel-file/node";
import sanitizeHtml from "sanitize-html";
import { ApiError } from "../errors";
import { Semaphore } from "../lib/semaphore";
import { DOCX, XLSX, getFile } from "./files";
import { resolveKey } from "./storage";

export const VIEW_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 5000;
export const MAX_ZIP_UNCOMPRESSED = 50 * 1024 * 1024;
export const MAX_VIEW_HTML = 8 * 1024 * 1024;
export const VIEW_TIMEOUT_MS = 10_000;
const MAX_ROWS = 2000;
const MAX_COLS = 500;

// Giữ mammoth/read-excel-file trong đồ thị import để Next (output: standalone) chép chúng vào bản đóng gói;
// worker nạp lại bằng require từ process.cwd().
export const __viewDeps = { mammoth, readXlsx };

/**
 * Lọc nhanh bằng central directory (rẻ, chạy ở luồng chính): số mục + tổng kích thước KHAI BÁO.
 * Chưa đủ vì kích thước khai báo có thể nói dối; bước giải nén thật có giới hạn nằm trong worker.
 */
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

/**
 * Mã chạy trong worker_threads (eval, CommonJS). Làm 3 việc, đều có trần:
 *  1. giải nén THẬT từng mục zip với maxOutputLength (không tin kích thước khai báo) -> too_large nếu > trần;
 *  2. mammoth (docx) hoặc read-excel-file (xlsx);
 *  3. cắt dòng/cột/ô trước khi gửi về.
 * Trả về qua postMessage: {ok:true, result} | {ok:false, code}.
 */
export const VIEW_WORKER_SOURCE = String.raw`
const { parentPort, workerData: W } = require("node:worker_threads");
const zlib = require("node:zlib");
const { createRequire } = require("node:module");
const fail = (code) => { const e = new Error(code); e.viewCode = code; return e; };
function guard(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw fail("bad_zip");
  const total = b.readUInt16LE(eocd + 10);
  if (total > W.maxEntries) throw fail("too_large");
  let off = b.readUInt32LE(eocd + 16), real = 0;
  for (let n = 0; n < total; n++) {
    if (off + 46 > b.length || b.readUInt32LE(off) !== 0x02014b50) throw fail("bad_zip");
    const method = b.readUInt16LE(off + 10), csize = b.readUInt32LE(off + 20), usize = b.readUInt32LE(off + 24), lho = b.readUInt32LE(off + 42);
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw fail("bad_zip");
    if (lho + 30 > b.length || b.readUInt32LE(lho) !== 0x04034b50) throw fail("bad_zip");
    const start = lho + 30 + b.readUInt16LE(lho + 26) + b.readUInt16LE(lho + 28);
    if (start + csize > b.length) throw fail("bad_zip");
    const data = b.subarray(start, start + csize);
    if (method === 0) real += csize;
    else if (method === 8) {
      try { real += zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, W.maxUncompressed - real + 1) }).length; }
      catch (e) { throw fail(e && e.code === "ERR_BUFFER_TOO_LARGE" ? "too_large" : "bad_zip"); }
    } else throw fail("bad_zip");
    if (real > W.maxUncompressed) throw fail("too_large");
    off += 46 + b.readUInt16LE(off + 28) + b.readUInt16LE(off + 30) + b.readUInt16LE(off + 32);
  }
}
const cell = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().replace(/T00:00:00\.000Z$/, "").replace(".000Z", "Z");
  return String(v).slice(0, 2000);
};
(async () => {
  try {
    const buf = Buffer.from(W.buf.buffer, W.buf.byteOffset, W.buf.byteLength);
    guard(buf);
    const req = createRequire(W.base);
    if (W.kind === "docx") {
      const r = await req("mammoth").convertToHtml({ buffer: buf });
      if (r.value.length > W.maxHtml) throw fail("too_large");
      parentPort.postMessage({ ok: true, result: { kind: "html", html: r.value } });
    } else {
      const mod = req("read-excel-file/node");
      const read = typeof mod === "function" ? mod : mod.default;
      const sheets = await read(buf);
      parentPort.postMessage({ ok: true, result: { kind: "sheets", sheets: sheets.map((s) => {
        const data = s.data, width = data.reduce((m, r) => Math.max(m, r.length), 0);
        return { name: String(s.sheet).slice(0, 100), truncated: data.length > W.maxRows || width > W.maxCols,
          rows: data.slice(0, W.maxRows).map((r) => r.slice(0, W.maxCols).map(cell)) };
      }) } });
    }
  } catch (e) {
    parentPort.postMessage({ ok: false, code: (e && e.viewCode) || "parse_failed" });
  }
})();
`;

const workerGate = new Semaphore(2, 16);

export interface WorkerOpts {
  timeoutMs?: number;
  resourceLimits?: { maxOldGenerationSizeMb?: number; maxYoungGenerationSizeMb?: number };
  source?: string; // chỉ test dùng để mô phỏng worker treo/ngốn bộ nhớ
}
type WorkerMsg = { ok: true; result: unknown } | { ok: false; code: string };

/** Chạy mã trong worker với trần bộ nhớ heap + timeout; hết hạn thì terminate. Lỗi map sang ApiError 413/422. */
export function runViewWorker(data: Record<string, unknown>, o: WorkerOpts = {}): Promise<unknown> {
  return workerGate.run(
    () =>
      new Promise((resolve, reject) => {
        const w = new Worker(o.source ?? VIEW_WORKER_SOURCE, {
          eval: true,
          workerData: data,
          resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, ...o.resourceLimits },
        });
        let done = false;
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          void w.terminate();
          fn();
        };
        const timer = setTimeout(
          () => finish(() => reject(new ApiError("validation", "Xử lý tệp quá lâu (quá 10 giây), không thể xem trong trang."))),
          o.timeoutMs ?? VIEW_TIMEOUT_MS,
        );
        w.on("message", (m: WorkerMsg) =>
          finish(() => {
            if (m.ok) return resolve(m.result);
            if (m.code === "too_large") return reject(new ApiError("payload_too_large", "Tệp giải nén quá lớn để xem trong trang."));
            reject(new ApiError("validation", "Không đọc được tệp này (hỏng hoặc không hợp lệ)."));
          }),
        );
        w.on("error", (e: NodeJS.ErrnoException) =>
          finish(() =>
            reject(
              e.code === "ERR_WORKER_OUT_OF_MEMORY"
                ? new ApiError("payload_too_large", "Tệp cần quá nhiều bộ nhớ để xem trong trang.")
                : new ApiError("validation", "Không đọc được tệp này."),
            ),
          ),
        );
        w.on("exit", () => finish(() => reject(new ApiError("validation", "Không đọc được tệp này."))));
      }),
  );
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

export async function viewFile(id: string) {
  const f = await getFile(id);
  if (f.mime !== DOCX && f.mime !== XLSX) throw new ApiError("unsupported_media_type", "Không hỗ trợ xem loại tệp này.");
  if (Number(f.size) > VIEW_MAX_BYTES) throw new ApiError("payload_too_large", "Tệp quá lớn để xem trong trang (tối đa 10 MB).");
  let buf: Buffer;
  try {
    buf = await fs.readFile(resolveKey(f.storageKey));
  } catch {
    throw new ApiError("not_found", "Nội dung tệp không còn trên máy chủ.");
  }
  if (buf.byteLength > VIEW_MAX_BYTES) throw new ApiError("payload_too_large", "Tệp quá lớn để xem trong trang (tối đa 10 MB).");
  assertZipSane(buf);
  const r = (await runViewWorker({
    kind: f.mime === DOCX ? "docx" : "xlsx",
    buf: new Uint8Array(buf),
    base: `${process.cwd()}/noop.js`,
    maxEntries: MAX_ZIP_ENTRIES,
    maxUncompressed: MAX_ZIP_UNCOMPRESSED,
    maxHtml: MAX_VIEW_HTML,
    maxRows: MAX_ROWS,
    maxCols: MAX_COLS,
  })) as { kind: "html"; html: string } | { kind: "sheets"; sheets: { name: string; rows: string[][]; truncated: boolean }[] };
  return r.kind === "html" ? { kind: "html" as const, html: sanitizeDocHtml(r.html) } : r;
}
