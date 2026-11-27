import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { GET as listItems, POST as createItem } from "@/app/api/items/route";
import { DELETE as delItem, GET as getItem } from "@/app/api/items/[id]/route";
import { DELETE as delItemIcon, GET as getItemIcon, PUT as putItemIcon } from "@/app/api/items/[id]/icon/route";
import { GET as listTopics, POST as createTopic } from "@/app/api/topics/route";
import { DELETE as delTopic, PATCH as patchTopic } from "@/app/api/topics/[id]/route";
import { DELETE as delTopicIcon, GET as getTopicIcon, PUT as putTopicIcon } from "@/app/api/topics/[id]/icon/route";
import { GET as searchGet } from "@/app/api/search/route";
import { ICON_MAX_BYTES } from "@/server/services/icons";
import { EXE, PNG } from "./fixtures";
import { call, jsonOf, resetData, session } from "./helpers";

let s: Awaited<ReturnType<typeof session>>;
let itemId: string;
let topicId: string;

beforeAll(async () => {
  await resetData();
  s = await session();
  topicId = (await jsonOf(await call(createTopic, "/api/topics", { method: "POST", cookie: s.cookie, body: { name: "Có ảnh" } }))).id;
  itemId = (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "tool", title: "Mục có ảnh", url: "https://example.com", topicId } }))).id;
});

/** PNG hợp lệ độn thêm đuôi cho đủ `n` byte (file-type chỉ nhìn phần đầu). */
const pngOf = (n: number) => Buffer.concat([PNG, Buffer.alloc(Math.max(0, n - PNG.length), 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(40, 1)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0x3b])]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([40, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 0)]);

type Kind = "item" | "topic";
const H = {
  item: { get: getItemIcon, put: putItemIcon, del: delItemIcon, id: () => itemId, base: "items" },
  topic: { get: getTopicIcon, put: putTopicIcon, del: delTopicIcon, id: () => topicId, base: "topics" },
} as const;
const put = (k: Kind, data: Uint8Array, o: { type?: string; cookie?: string | null; origin?: string | null; id?: string } = {}) => {
  const id = o.id ?? H[k].id();
  return call(H[k].put, `/api/${H[k].base}/${id}/icon`, {
    method: "PUT", raw: data, contentType: o.type ?? "image/png", params: { id },
    cookie: o.cookie === undefined ? s.cookie : o.cookie, ...(o.origin !== undefined ? { origin: o.origin } : {}),
  });
};
const get = (k: Kind, headers: Record<string, string> = {}, id = H[k].id(), cookie: string | null = s.cookie) =>
  call(H[k].get, `/api/${H[k].base}/${id}/icon`, { cookie, params: { id }, headers });
const del = (k: Kind, o: { cookie?: string | null; origin?: string | null } = {}) =>
  call(H[k].del, `/api/${H[k].base}/${H[k].id()}/icon`, {
    method: "DELETE", params: { id: H[k].id() }, cookie: o.cookie === undefined ? s.cookie : o.cookie, ...(o.origin !== undefined ? { origin: o.origin } : {}),
  });
const hasImage = async (k: Kind) =>
  ((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${k} WHERE id = '${H[k].id()}' AND icon_image IS NOT NULL`))[0]!.n) === 1;

describe.each(["item", "topic"] as const)("ảnh biểu tượng của %s", (k) => {
  it("PUT png hợp lệ -> 200 kèm iconImageUrl; GET trả đúng bytes, mime thật và header an toàn", async () => {
    const r = await put(k, PNG);
    expect(r.status).toBe(200);
    const dto = await jsonOf(r);
    expect(dto.iconImageUrl).toMatch(new RegExp(`^/api/${H[k].base}/${H[k].id()}/icon\\?v=\\d+$`));
    expect(dto).not.toHaveProperty("iconImage");

    const g = await get(k);
    expect(g.status).toBe(200);
    expect(Buffer.from(await g.arrayBuffer()).equals(PNG)).toBe(true);
    expect(g.headers.get("content-type")).toBe("image/png");
    expect(g.headers.get("x-content-type-options")).toBe("nosniff");
    // Không có ?v= → phải revalidate bằng ETag; có ?v= khớp → bất biến (L1 của review).
    expect(g.headers.get("cache-control")).toBe("private, no-cache");
    const gv = await call(H[k].get, dto.iconImageUrl as string, { cookie: s.cookie, params: { id: H[k].id() } });
    expect(gv.status).toBe(200);
    expect(gv.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    const gOld = await call(H[k].get, `/api/${H[k].base}/${H[k].id()}/icon?v=1`, { cookie: s.cookie, params: { id: H[k].id() } });
    expect(gOld.headers.get("cache-control")).toBe("private, no-cache");
    expect(g.headers.get("content-security-policy")).toMatch(/default-src 'none'.*sandbox/);
    expect(g.headers.get("content-length")).toBe(String(PNG.length));
    expect(await prisma.auditLog.count({ where: { action: `${k}.icon_set`, entityId: H[k].id() } })).toBeGreaterThanOrEqual(1);
  });

  it("If-None-Match khớp ETag -> 304 không thân", async () => {
    const etag = (await get(k)).headers.get("etag")!;
    expect(etag).toBeTruthy();
    const r = await get(k, { "if-none-match": etag });
    expect(r.status).toBe(304);
    expect((await r.arrayBuffer()).byteLength).toBe(0);
  });

  it("đổi ảnh: ?v= đổi theo iconUpdatedAt và GET trả ảnh mới", async () => {
    const v1 = (await jsonOf(await put(k, PNG))).iconImageUrl;
    await new Promise((r) => setTimeout(r, 15));
    const next = pngOf(300);
    const v2 = (await jsonOf(await put(k, next))).iconImageUrl;
    expect(v2).not.toBe(v1);
    expect(Buffer.from(await (await get(k)).arrayBuffer()).equals(next)).toBe(true);
  });

  it("multipart (trường file) cũng được; thiếu trường file -> 422", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(PNG)], "icon.png", { type: "image/png" }));
    const ok = await call(H[k].put, `/api/${H[k].base}/${H[k].id()}/icon`, { method: "PUT", form, cookie: s.cookie, params: { id: H[k].id() } });
    expect(ok.status).toBe(200);
    expect(Buffer.from(await (await get(k)).arrayBuffer()).equals(PNG)).toBe(true);
    const none = new FormData();
    none.append("other", "x");
    const bad = await call(H[k].put, `/api/${H[k].base}/${H[k].id()}/icon`, { method: "PUT", form: none, cookie: s.cookie, params: { id: H[k].id() } });
    expect(bad.status).toBe(422);
  });

  it.each([["jpeg", JPEG, "image/jpeg"], ["gif", GIF, "image/gif"], ["webp", WEBP, "image/webp"]] as const)("nhận %s theo magic bytes", async (_n, buf, mime) => {
    expect((await put(k, buf, { type: "application/octet-stream" })).status).toBe(200);
    const g = await get(k);
    expect(g.headers.get("content-type")).toBe(mime);
    expect(Buffer.from(await g.arrayBuffer()).equals(buf)).toBe(true);
  });

  it("SVG, HTML, exe, văn bản, PNG giả (magic sai, Content-Type vẫn image/png) -> 415 và không ghi gì", async () => {
    await del(k);
    const bad: [string, Buffer][] = [
      ["svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>')],
      ["html", Buffer.from("<!doctype html><script>alert(1)</script>")],
      ["exe", EXE],
      ["text", Buffer.from("hello world")],
      ["png giả", Buffer.concat([Buffer.from("XPNG\r\n\x1a\n"), PNG.subarray(8)])],
      ["png thiếu đầu", PNG.subarray(1)],
      ["svg đội lốt png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ];
    for (const [name, buf] of bad) {
      const r = await put(k, buf, { type: "image/png" });
      expect(r.status, name).toBe(415);
      expect((await jsonOf(r)).error.code).toBe("unsupported_media_type");
    }
    expect(await hasImage(k)).toBe(false);
    expect((await get(k)).status).toBe(404);
  });

  it("rỗng -> 422; quá 64 KB -> 413 (đủ 64 KB thì nhận); multipart quá 64 KB -> 413", async () => {
    expect((await put(k, new Uint8Array(0))).status).toBe(422);
    const over = await put(k, pngOf(ICON_MAX_BYTES + 1));
    expect(over.status).toBe(413);
    expect((await jsonOf(over)).error.code).toBe("payload_too_large");
    expect(await hasImage(k)).toBe(false);
    // Không khai Content-Length (luồng): vẫn bị chặn khi đọc.
    const stream = await call(H[k].put, `/api/${H[k].base}/${H[k].id()}/icon`, {
      method: "PUT", raw: pngOf(ICON_MAX_BYTES * 3), contentType: "image/png", params: { id: H[k].id() }, cookie: s.cookie,
    });
    expect(stream.status).toBe(413);
    const form = new FormData();
    form.append("file", new File([new Uint8Array(pngOf(ICON_MAX_BYTES + 1))], "big.png", { type: "image/png" }));
    expect((await call(H[k].put, `/api/${H[k].base}/${H[k].id()}/icon`, { method: "PUT", form, cookie: s.cookie, params: { id: H[k].id() } })).status).toBe(413);
    expect((await put(k, pngOf(ICON_MAX_BYTES))).status).toBe(200);
  });

  it("chưa đăng nhập -> 401 (PUT/GET/DELETE); thiếu Origin hoặc Origin lạ -> 403 (PUT/DELETE), không ghi gì", async () => {
    await del(k);
    expect((await put(k, PNG, { cookie: null })).status).toBe(401);
    expect((await get(k, {}, H[k].id(), null)).status).toBe(401);
    expect((await del(k, { cookie: null })).status).toBe(401);
    expect((await put(k, PNG, { origin: null })).status).toBe(403);
    expect((await put(k, PNG, { origin: "http://evil.test" })).status).toBe(403);
    expect((await del(k, { origin: null })).status).toBe(403);
    expect(await hasImage(k)).toBe(false);
    await put(k, PNG);
    expect((await del(k, { origin: "http://evil.test" })).status).toBe(403);
    expect(await hasImage(k)).toBe(true);
  });

  it("DELETE -> 204, iconImageUrl về null, GET -> 404; xoá lần nữa vẫn 204; ghi audit", async () => {
    await put(k, PNG);
    expect((await del(k)).status).toBe(204);
    expect((await get(k)).status).toBe(404);
    const dto = k === "item"
      ? await jsonOf(await call(getItem, `/api/items/${itemId}`, { cookie: s.cookie, params: { id: itemId } }))
      : (await jsonOf(await call(listTopics, "/api/topics", { cookie: s.cookie }))).topics.find((t: any) => t.id === topicId);
    expect(dto.iconImageUrl).toBeNull();
    expect((await del(k)).status).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: `${k}.icon_clear`, entityId: H[k].id() } })).toBeGreaterThanOrEqual(1);
  });

  it("id lạ / không phải uuid -> 404 (PUT, GET, DELETE)", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect((await put(k, PNG, { id: ghost })).status).toBe(404);
    expect((await put(k, PNG, { id: "xyz" })).status).toBe(404);
    expect((await get(k, {}, ghost)).status).toBe(404);
    expect((await get(k, {}, "xyz")).status).toBe(404);
    const d = await call(H[k].del, `/api/${H[k].base}/${ghost}/icon`, { method: "DELETE", cookie: s.cookie, params: { id: ghost } });
    expect(d.status).toBe(404);
  });
});

describe("danh sách không kéo bytea", () => {
  it("GET /api/items và /api/search: có iconImageUrl, không có iconImage/iconMime, JSON không chứa dữ liệu ảnh", async () => {
    const big = pngOf(20_000);
    await put("item", big);
    await put("topic", big);
    const r = await call(listItems, "/api/items", { cookie: s.cookie, query: { topic: topicId } });
    const text = await r.text();
    const body = JSON.parse(text);
    const it = body.items.find((x: any) => x.id === itemId);
    expect(it.iconImageUrl).toMatch(/^\/api\/items\/.+\/icon\?v=\d+$/);
    expect(it).not.toHaveProperty("iconImage");
    expect(it).not.toHaveProperty("iconMime");
    expect(text.length).toBeLessThan(5_000);
    expect(text).not.toContain(big.subarray(100, 140).toString("base64"));

    const s2 = await call(searchGet, "/api/search", { cookie: s.cookie, query: { q: "ảnh" } });
    const sb = await jsonOf(s2);
    expect(sb.items.find((x: any) => x.id === itemId).iconImageUrl).toBeTruthy();
    expect(sb.topics.find((x: any) => x.id === topicId).iconImageUrl).toMatch(/^\/api\/topics\/.+\/icon\?v=\d+$/);
    expect(JSON.stringify(sb)).not.toContain("iconImage\":{");

    const tops = JSON.stringify(await jsonOf(await call(listTopics, "/api/topics", { cookie: s.cookie })));
    expect(tops.length).toBeLessThan(2_000);
  });

  it("PrismaClient mặc định bỏ cột bytea (omit toàn cục); chỉ select tường minh mới có", async () => {
    const it = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(it).not.toHaveProperty("iconImage");
    expect(it.iconUpdatedAt).toBeInstanceOf(Date);
    const t = (await prisma.topic.findMany({ where: { id: topicId } }))[0]!;
    expect(t).not.toHaveProperty("iconImage");
    const explicit = await prisma.item.findUniqueOrThrow({ where: { id: itemId }, select: { iconImage: true } });
    expect(explicit.iconImage?.byteLength).toBe(20_000);
  });
});

describe("ràng buộc DB (CHECK)", () => {
  it("DB từ chối mime ngoài danh sách, ảnh > 64 KB, và ảnh/mime/thời điểm không đi cùng nhau", async () => {
    await del("item");
    const run = (sql: string) => prisma.$executeRawUnsafe(`UPDATE item SET ${sql} WHERE id = '${itemId}'`);
    await expect(run(`icon_image = '\\x89504e47'::bytea, icon_mime = 'image/svg+xml', icon_updated_at = now()`)).rejects.toThrow();
    await expect(run(`icon_image = '\\x89504e47'::bytea, icon_mime = 'image/png'`)).rejects.toThrow(); // thiếu icon_updated_at
    await expect(run(`icon_mime = 'image/png', icon_updated_at = now()`)).rejects.toThrow(); // có mime không có ảnh
    await expect(run(`icon_image = decode(repeat('00', ${ICON_MAX_BYTES + 1}), 'hex'), icon_mime = 'image/png', icon_updated_at = now()`)).rejects.toThrow();
    await expect(run(`icon_image = decode(repeat('00', ${ICON_MAX_BYTES}), 'hex'), icon_mime = 'image/png', icon_updated_at = now()`)).resolves.toBe(1);
    await del("item");
  });
});

describe("vòng đời", () => {
  it("PATCH topic icon rỗng -> null; PATCH item không đụng ảnh", async () => {
    await put("item", PNG);
    const r = await call(patchTopic, `/api/topics/${topicId}`, { method: "PATCH", cookie: s.cookie, params: { id: topicId }, body: { icon: "" } });
    expect((await jsonOf(r)).icon).toBeNull();
    await call(delItem, `/api/items/${itemId}`, { method: "DELETE", cookie: s.cookie, params: { id: itemId }, query: { hard: "0" } });
    expect(await hasImage("item")).toBe(true); // lưu trữ không xoá ảnh
  });

  it("xoá cứng item và xoá topic xoá luôn ảnh (cùng hàng)", async () => {
    const t = (await jsonOf(await call(createTopic, "/api/topics", { method: "POST", cookie: s.cookie, body: { name: "Tạm" } }))).id as string;
    const i = (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "Tạm" } }))).id as string;
    expect((await put("topic", PNG, { id: t })).status).toBe(200);
    expect((await put("item", PNG, { id: i })).status).toBe(200);
    expect((await call(delItem, `/api/items/${i}`, { method: "DELETE", cookie: s.cookie, params: { id: i }, query: { hard: "1" } })).status).toBe(204);
    expect((await call(delTopic, `/api/topics/${t}`, { method: "DELETE", cookie: s.cookie, params: { id: t } })).status).toBe(204);
    expect((await get("item", {}, i)).status).toBe(404);
    expect((await get("topic", {}, t)).status).toBe(404);
    const n = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT (SELECT count(*) FROM item WHERE id='${i}') + (SELECT count(*) FROM topic WHERE id='${t}') AS n`);
    expect(Number(n[0]!.n)).toBe(0);
  });
});
