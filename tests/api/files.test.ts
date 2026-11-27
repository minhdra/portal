import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { POST as createItem } from "@/app/api/items/route";
import { DELETE as delItem } from "@/app/api/items/[id]/route";
import { GET as listFiles, POST as upload } from "@/app/api/items/[id]/files/route";
import { DELETE as delFile, GET as getFile } from "@/app/api/files/[id]/route";
import { GET as view } from "@/app/api/files/[id]/view/route";
import { GET as getItem } from "@/app/api/items/[id]/route";
import { parseRange, sanitizeFilename } from "@/server/services/files";
import { resolveKey } from "@/server/services/storage";
import { assertZipSane, sanitizeDocHtml } from "@/server/services/view";
import { EXE, PNG, makeDocx, makeXlsx, pdf } from "./fixtures";
import { call, jsonOf, resetData, session } from "./helpers";

let s: Awaited<ReturnType<typeof session>>;
let itemId: string;
const root = () => path.resolve(process.env.UPLOAD_DIR!);

beforeAll(async () => {
  await resetData();
  s = await session();
  itemId = (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "Có tệp" } }))).id;
});

const up = (id: string, files: { name: string; data: Buffer; type?: string }[], field = "file") => {
  const form = new FormData();
  for (const f of files) form.append(field, new File([new Uint8Array(f.data)], f.name, { type: f.type ?? "application/octet-stream" }));
  return call(upload, `/api/items/${id}/files`, { method: "POST", cookie: s.cookie, params: { id }, form });
};
const fget = (id: string, headers: Record<string, string> = {}, query: Record<string, string> = {}, method = "GET") =>
  call(getFile, `/api/files/${id}`, { cookie: s.cookie, params: { id }, headers, query, method });
const upOne = async (name: string, data: Buffer, id = itemId) => {
  const r = await up(id, [{ name, data }]);
  return { r, b: await jsonOf(r) };
};
const allBlobs = (dir = root()): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allBlobs(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];

describe("upload", () => {
  it("png hợp lệ: 201, đường dẫn yyyy/mm/uuid không chứa tên gốc, nội dung đúng", async () => {
    const { r, b } = await upOne("Ảnh đẹp.png", PNG);
    expect(r.status).toBe(201);
    const f = b.files[0];
    expect(f).toMatchObject({ originalName: "Ảnh đẹp.png", mime: "image/png", size: PNG.length });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    const row = await prisma.file.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(row.storageKey).not.toMatch(/nh|png/i);
    expect(fs.readFileSync(path.join(root(), row.storageKey)).equals(PNG)).toBe(true);
    expect((await jsonOf(await call(getItem, `/api/items/${itemId}`, { cookie: s.cookie, params: { id: itemId } }))).fileCount).toBeGreaterThanOrEqual(1);
    expect((await prisma.auditLog.count({ where: { action: "file.upload", entityId: f.id } }))).toBe(1);
  });

  it("magic bytes: đuôi .png nhưng là exe -> 415; html/svg/js -> 415; PNG đổi tên .html lưu theo nội dung", async () => {
    expect((await upOne("fake.png", EXE)).r.status).toBe(415);
    expect((await upOne("a.html", Buffer.from("<script>alert(1)</script>"))).r.status).toBe(415);
    expect((await upOne("a.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).r.status).toBe(415);
    expect((await upOne("noext", Buffer.from("hello"))).r.status).toBe(415);
    expect((await upOne("bin.txt", Buffer.from([0x68, 0x00, 0x69]))).r.status).toBe(415); // NUL trong "văn bản"
    expect((await upOne("bad.txt", Buffer.from([0xff, 0xfe, 0xfd]))).r.status).toBe(415); // không phải UTF-8
    const o = await upOne("tricky.html", Buffer.concat([PNG, Buffer.from("x")]));
    expect(o.r.status).toBe(201);
    expect(o.b.files[0].mime).toBe("image/png");
  });

  it("khử tên & chặn path traversal", async () => {
    expect(sanitizeFilename("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeFilename("..\\..\\win\\x.pdf")).toBe("x.pdf");
    expect(sanitizeFilename(".htaccess")).toBe("htaccess");
    expect(sanitizeFilename("a‮b\u0000.png")).toBe("ab.png");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("x".repeat(500) + ".pdf").length).toBeLessThanOrEqual(200);
    const before = allBlobs().length;
    const { r, b } = await upOne("../../../../tmp/evil.png", Buffer.concat([PNG, Buffer.from("trav")]));
    expect(r.status).toBe(201);
    expect(b.files[0].originalName).toBe("evil.png");
    expect(allBlobs().length).toBe(before + 1);
    expect(allBlobs().every((p) => p.startsWith(root() + path.sep))).toBe(true);
    // resolveKey từ chối khoá bẩn
    for (const k of ["../x", "2026/11/../../x", "/etc/passwd", "2026/11/abc", "2026/11/00000000-0000-0000-0000-000000000000/../../../x"]) {
      expect(() => resolveKey(k), k).toThrow();
    }
  });

  it("dedupe theo sha256 trong cùng item; item khác thì lưu riêng", async () => {
    const other = (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "Khác" } }))).id;
    const data = pdf("dedupe");
    const a = await upOne("a.pdf", data);
    const before = allBlobs().length;
    const b = await upOne("b.pdf", data);
    expect(b.r.status).toBe(201);
    expect(b.b.files[0].id).toBe(a.b.files[0].id);
    expect(b.b.files[0].duplicate).toBe(true);
    expect(allBlobs().length).toBe(before);
    const c = await upOne("c.pdf", data, other);
    expect(c.b.files[0].id).not.toBe(a.b.files[0].id);
    expect(allBlobs().length).toBe(before + 1);
    // nhiều file một lần, trùng trong cùng request
    const m = await up(other, [{ name: "m1.pdf", data: pdf("m") }, { name: "m2.pdf", data: pdf("m") }, { name: "n.png", data: PNG }]);
    expect(m.status).toBe(201);
    const files = (await jsonOf(m)).files;
    expect(files).toHaveLength(3);
    expect(files[0].id).toBe(files[1].id);
  });

  it("lỗi: tệp > 50MB -> 413; rỗng -> 422; thiếu field -> 422; không phải multipart -> 422; item lạ -> 404", async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1);
    PNG.copy(big);
    expect((await upOne("big.png", big)).r.status).toBe(413);
    expect((await upOne("empty.txt", Buffer.alloc(0))).r.status).toBe(422);
    expect((await up(itemId, [{ name: "x.png", data: PNG }], "khac")).status).toBe(422);
    const r = await call(upload, `/api/items/${itemId}/files`, { method: "POST", cookie: s.cookie, params: { id: itemId }, body: { a: 1 } });
    expect(r.status).toBe(422);
    expect((await up("00000000-0000-4000-8000-000000000000", [{ name: "x.png", data: PNG }])).status).toBe(404);
    expect((await up("xx", [{ name: "x.png", data: PNG }])).status).toBe(404);
  });

  it("GET /items/:id/files liệt kê", async () => {
    const r = await call(listFiles, `/api/items/${itemId}/files`, { cookie: s.cookie, params: { id: itemId } });
    expect(r.status).toBe(200);
    expect((await jsonOf(r)).files.length).toBeGreaterThan(0);
  });
});

describe("tải file", () => {
  it("png inline + nosniff + CSP sandbox + ETag/304", async () => {
    const { b } = await upOne("serve.png", Buffer.concat([PNG, Buffer.from("serve")]));
    const id = b.files[0].id;
    const r = await fget(id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toBe("sandbox; frame-ancestors 'self'");
    expect(r.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await r.arrayBuffer()).length).toBe(PNG.length + 5);
    const etag = r.headers.get("etag")!;
    expect((await fget(id, { "if-none-match": etag })).status).toBe(304);
    const dl = await fget(id, {}, { download: "1" });
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment;/);
    await dl.arrayBuffer();
  });

  it("docx/xlsx -> attachment; txt/markdown inline dạng text; tên có dấu mã hoá RFC 5987", async () => {
    const d = await upOne("Báo cáo.docx", await makeDocx(["xin chào"]));
    const r = await fget(d.b.files[0].id);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="B_o c_o\.docx"; filename\*=UTF-8''B%C3%A1o%20c%C3%A1o\.docx$/);
    await r.arrayBuffer();
    const t = await upOne("note.md", Buffer.from("# tiêu đề <script>alert(1)</script>"));
    const tr = await fget(t.b.files[0].id);
    expect(tr.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(tr.headers.get("content-disposition")).toMatch(/^inline/);
    expect(tr.headers.get("x-content-type-options")).toBe("nosniff");
    await tr.arrayBuffer();
  });

  it("Range: đầu, đoạn giữa, hậu tố, mở đầu; 416 khi vượt; nhiều khoảng -> 200 đủ", async () => {
    const data = pdf("range-" + "0123456789".repeat(20));
    const { b } = await upOne("r.pdf", data);
    const id = b.files[0].id;
    const body = async (r: Response) => Buffer.from(await r.arrayBuffer());
    const r1 = await fget(id, { range: "bytes=0-3" });
    expect(r1.status).toBe(206);
    expect(r1.headers.get("content-range")).toBe(`bytes 0-3/${data.length}`);
    expect(r1.headers.get("content-length")).toBe("4");
    expect((await body(r1)).equals(data.subarray(0, 4))).toBe(true);
    const r2 = await fget(id, { range: "bytes=10-19" });
    expect((await body(r2)).equals(data.subarray(10, 20))).toBe(true);
    const r3 = await fget(id, { range: "bytes=-8" });
    expect(r3.status).toBe(206);
    expect((await body(r3)).equals(data.subarray(data.length - 8))).toBe(true);
    const r4 = await fget(id, { range: `bytes=${data.length - 5}-` });
    expect((await body(r4)).equals(data.subarray(data.length - 5))).toBe(true);
    const r5 = await fget(id, { range: `bytes=${data.length + 10}-` });
    expect(r5.status).toBe(416);
    expect(r5.headers.get("content-range")).toBe(`bytes */${data.length}`);
    const r6 = await fget(id, { range: "bytes=0-1,5-6" });
    expect(r6.status).toBe(200);
    expect((await body(r6)).equals(data)).toBe(true);
    const head = await fget(id, {}, {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(data.length));
  });

  it("parseRange", () => {
    expect(parseRange(null, 100)).toBe("full");
    expect(parseRange("bytes=0-0", 100)).toEqual({ start: 0, end: 0 });
    expect(parseRange("bytes=90-999", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=5-2", 100)).toBe("invalid");
    expect(parseRange("bytes=-", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
    expect(parseRange("items=1-2", 100)).toBe("full");
  });

  it("404: id lạ / blob mất", async () => {
    expect((await fget("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await fget("../etc/passwd")).status).toBe(404);
    const { b } = await upOne("gone.png", Buffer.concat([PNG, Buffer.from("gone")]));
    const row = await prisma.file.findUniqueOrThrow({ where: { id: b.files[0].id } });
    fs.unlinkSync(path.join(root(), row.storageKey));
    expect((await fget(row.id)).status).toBe(404);
  });
});

describe("view docx / xlsx", () => {
  const v = (id: string) => call(view, `/api/files/${id}/view`, { cookie: s.cookie, params: { id } });

  it("docx -> {kind:html}", async () => {
    const { b } = await upOne("v.docx", await makeDocx(["Xin chào Hà Nội", "Dòng hai"]));
    const r = await v(b.files[0].id);
    expect(r.status).toBe(200);
    const j = await jsonOf(r);
    expect(j.kind).toBe("html");
    expect(j.html).toContain("<p>Xin chào Hà Nội</p>");
    expect(j.html).toContain("Dòng hai");
  });

  it("xlsx -> {kind:sheets}, giới hạn 2000 dòng/500 cột + truncated", async () => {
    const small = await upOne("v.xlsx", await makeXlsx([["Tên", "Tuổi"], ["An", "30"], ["Bình", "25"]], "Danh sách"));
    const j = await jsonOf(await v(small.b.files[0].id));
    expect(j.kind).toBe("sheets");
    expect(j.sheets[0]).toEqual({ name: "Danh sách", rows: [["Tên", "Tuổi"], ["An", "30"], ["Bình", "25"]], truncated: false });
    const rows = Array.from({ length: 2100 }, (_, i) => [`r${i}`, ...Array.from({ length: 520 }, (_, c) => `c${c}`)].slice(0, i === 0 ? 521 : 2));
    const big = await upOne("big.xlsx", await makeXlsx(rows));
    const jb = await jsonOf(await v(big.b.files[0].id));
    expect(jb.sheets[0].rows).toHaveLength(2000);
    expect(jb.sheets[0].rows[0]).toHaveLength(500);
    expect(jb.sheets[0].truncated).toBe(true);
  });

  it("loại khác -> 415; id lạ -> 404", async () => {
    const { b } = await upOne("v.png", Buffer.concat([PNG, Buffer.from("view")]));
    const r = await v(b.files[0].id);
    expect(r.status).toBe(415);
    expect((await jsonOf(r)).error.code).toBe("unsupported_media_type");
    expect((await v("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("lọc HTML (trong worker): bỏ script/style/on*/javascript:, giữ thẻ an toàn", async () => {
    const dirty = `<p onclick="x()">a<script>alert(1)</script><style>p{}</style></p><a href="javascript:alert(1)">j</a><a href="https://ok.example/">ok</a>` +
      `<img src="javascript:alert(1)"><img src="x" onerror="e()"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:image/png;base64,AAAA" alt="i"><iframe src="//e"></iframe><table><tr><td colspan="2">c</td></tr></table>`;
    const out = await sanitizeDocHtml(dirty);
    expect(out).not.toMatch(/script|alert|onclick|onerror|javascript:|<style|iframe|svg/i);
    expect(out).toContain("https://ok.example/");
    expect(out).toContain("rel=\"noopener noreferrer nofollow\"");
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toContain('<td colspan="2">c</td>');
  });

  it("zip bomb: kích thước giải nén khai báo quá lớn bị chặn", async () => {
    const d = await makeDocx(["x"]);
    const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const at = d.indexOf(sig);
    expect(at).toBeGreaterThan(0);
    expect(() => assertZipSane(d)).not.toThrow();
    const bad = Buffer.from(d);
    bad.writeUInt32LE(0xfffffff0, at + 24);
    bad.writeUInt32LE(0xfffffff0, at + 24 + 0);
    // một mục là đủ vượt ngưỡng 200MB khi cộng 2 mục? dùng 1 mục khổng lồ: 4GB > 200MB
    expect(() => assertZipSane(bad)).toThrow();
  });
});

describe("xoá blob", () => {
  it("DELETE file xoá hàng và blob", async () => {
    const { b } = await upOne("del.png", Buffer.concat([PNG, Buffer.from("del")]));
    const row = await prisma.file.findUniqueOrThrow({ where: { id: b.files[0].id } });
    const p = path.join(root(), row.storageKey);
    expect(fs.existsSync(p)).toBe(true);
    const r = await call(delFile, `/api/files/${row.id}`, { method: "DELETE", cookie: s.cookie, params: { id: row.id } });
    expect(r.status).toBe(204);
    expect(fs.existsSync(p)).toBe(false);
    expect(await prisma.file.findUnique({ where: { id: row.id } })).toBeNull();
    expect((await call(delFile, `/api/files/${row.id}`, { method: "DELETE", cookie: s.cookie, params: { id: row.id } })).status).toBe(404);
  });

  it("xoá cứng item (?hard=1) xoá mọi blob của nó; lưu trữ thì giữ blob", async () => {
    const it = (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "Xoá cứng" } }))).id;
    const f1 = (await upOne("h1.png", Buffer.concat([PNG, Buffer.from("h1")]), it)).b.files[0].id;
    const f2 = (await upOne("h2.pdf", pdf("h2"), it)).b.files[0].id;
    const keys = (await prisma.file.findMany({ where: { id: { in: [f1, f2] } } })).map((f) => path.join(root(), f.storageKey));
    expect(keys.every((k) => fs.existsSync(k))).toBe(true);
    await call(delItem, `/api/items/${it}`, { method: "DELETE", cookie: s.cookie, params: { id: it } }); // lưu trữ
    expect(keys.every((k) => fs.existsSync(k))).toBe(true);
    const r = await call(delItem, `/api/items/${it}`, { method: "DELETE", cookie: s.cookie, params: { id: it }, query: { hard: "1" } });
    expect(r.status).toBe(204);
    expect(keys.some((k) => fs.existsSync(k))).toBe(false);
    expect(await prisma.file.count({ where: { id: { in: [f1, f2] } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "item.delete", entityId: it } })).toBe(1);
  });
});
