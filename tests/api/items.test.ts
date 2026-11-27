import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { GET as list, POST as create } from "@/app/api/items/route";
import { DELETE as del, GET as get, PATCH as patch } from "@/app/api/items/[id]/route";
import { POST as open } from "@/app/api/items/[id]/open/route";
import { POST as reorder } from "@/app/api/items/reorder/route";
import { GET as tags } from "@/app/api/tags/route";
import { GET as searchGet } from "@/app/api/search/route";
import { POST as createTopic } from "@/app/api/topics/route";
import { buildPrefixQuery } from "@/server/services/items";
import { normalizeUrl } from "@/server/lib/url";
import { call, jsonOf, resetData, session } from "./helpers";

let s: Awaited<ReturnType<typeof session>>;
beforeAll(async () => {
  await resetData();
  s = await session();
});

const mk = (body: unknown) => call(create, "/api/items", { method: "POST", cookie: s.cookie, body });
const ls = async (query: Record<string, string>) => jsonOf(await call(list, "/api/items", { cookie: s.cookie, query }));
const topic = async (name: string, parentId?: string) =>
  (await jsonOf(await call(createTopic, "/api/topics", { method: "POST", cookie: s.cookie, body: { name, parentId } }))).id as string;

describe("items CRUD", () => {
  it("tạo web item: 201, DTO đủ trường, tag sinh từ tên, url chuẩn hoá", async () => {
    const r = await mk({ type: "web", title: "Trang chủ", url: "https://example.com", tags: ["Công Cụ", "công cụ", "AI"] });
    expect(r.status).toBe(201);
    const b = await jsonOf(r);
    expect(Object.keys(b).sort()).toEqual(
      ["createdAt", "description", "fileCount", "icon", "iconImageUrl", "id", "lastOpenedAt", "pinned", "sortOrder", "status", "tags", "title", "topicId", "type", "updatedAt", "url"].sort(),
    );
    expect(b).toMatchObject({ status: "active", pinned: false, fileCount: 0, lastOpenedAt: null, url: "https://example.com/" });
    expect(b.tags.map((t: any) => t.slug).sort()).toEqual(["ai", "cong-cu"]);
  });

  it("validation: web/link thiếu url, url nguy hiểm, tiêu đề rỗng, topic lạ", async () => {
    expect((await mk({ type: "web", title: "x" })).status).toBe(422);
    expect((await mk({ type: "link", title: "x", url: "" })).status).toBe(422);
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://a.b", "//evil.com", "/\\evil.com", "https://u:p@a.b", "http://", "not a url", "file:///etc/passwd"]) {
      const r = await mk({ type: "web", title: "x", url });
      expect(r.status, url).toBe(422);
      expect((await jsonOf(r)).error.fields.url).toBeTruthy();
    }
    expect((await mk({ type: "doc", title: "  " })).status).toBe(422);
    expect((await mk({ type: "doc", title: "ok", topicId: "00000000-0000-4000-8000-000000000000" })).status).toBe(422);
    expect((await mk({ type: "xxx", title: "ok" })).status).toBe(422);
    expect((await mk({ type: "doc", title: "ok", tags: ["???"] })).status).toBe(422);
    expect((await mk({ type: "link", title: "nội bộ", url: "/auto-pull-nas/" })).status).toBe(201);
  });

  it("normalizeUrl", () => {
    expect(normalizeUrl("/x?y=1")).toBe("/x?y=1");
    expect(normalizeUrl("http://localhost:3000/a")).toBe("http://localhost:3000/a");
    expect(normalizeUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(normalizeUrl("https://a b.com")).toBeNull();
  });

  it("GET một mục, 404, PATCH các trường + status/pinned, đổi tag", async () => {
    const b = await jsonOf(await mk({ type: "tool", title: "Cũ", tags: ["a1", "b1"] }));
    const id = b.id;
    expect((await call(get, `/api/items/${id}`, { cookie: s.cookie, params: { id } })).status).toBe(200);
    expect((await call(get, `/api/items/x`, { cookie: s.cookie, params: { id: "x" } })).status).toBe(404);
    const r = await call(patch, `/api/items/${id}`, {
      method: "PATCH", cookie: s.cookie, params: { id },
      body: { title: "Mới", description: "Mô tả", pinned: true, status: "draft", tags: ["b1", "c1"], icon: "star" },
    });
    expect(r.status).toBe(200);
    const n = await jsonOf(r);
    expect(n).toMatchObject({ title: "Mới", description: "Mô tả", pinned: true, status: "draft", icon: "star" });
    expect(n.tags.map((t: any) => t.slug).sort()).toEqual(["b1", "c1"]);
    expect(new Date(n.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(b.updatedAt).getTime());
    // bỏ url của web/link bị từ chối
    const w = await jsonOf(await mk({ type: "web", title: "w", url: "https://w.example" }));
    const bad = await call(patch, `/api/items/${w.id}`, { method: "PATCH", cookie: s.cookie, params: { id: w.id }, body: { url: null } });
    expect(bad.status).toBe(422);
  });

  it("DELETE = lưu trữ; hard=1 xoá hẳn; 404 sau đó", async () => {
    const b = await jsonOf(await mk({ type: "doc", title: "Xoá thử" }));
    const id = b.id;
    expect((await call(del, `/api/items/${id}`, { method: "DELETE", cookie: s.cookie, params: { id } })).status).toBe(204);
    expect((await jsonOf(await call(get, `/api/items/${id}`, { cookie: s.cookie, params: { id } }))).status).toBe("archived");
    expect((await ls({ q: "Xoá thử" })).items).toHaveLength(0); // mặc định status=active
    expect((await ls({ q: "Xoá thử", status: "archived" })).items).toHaveLength(1);
    expect((await call(del, `/api/items/${id}`, { method: "DELETE", cookie: s.cookie, params: { id }, query: { hard: "1" } })).status).toBe(204);
    expect((await call(get, `/api/items/${id}`, { cookie: s.cookie, params: { id } })).status).toBe(404);
  });

  it("open ghi lastOpenedAt; recent=1 sắp theo mở gần nhất", async () => {
    const a = await jsonOf(await mk({ type: "doc", title: "Rc-A" }));
    const b = await jsonOf(await mk({ type: "doc", title: "Rc-B" }));
    const o = (id: string) => call(open, `/api/items/${id}/open`, { method: "POST", cookie: s.cookie, params: { id } });
    expect((await o(a.id)).status).toBe(204);
    await new Promise((r) => setTimeout(r, 15));
    expect((await o(b.id)).status).toBe(204);
    const rec = await ls({ recent: "1" });
    expect(rec.items.map((i: any) => i.id).slice(0, 2)).toEqual([b.id, a.id]);
    expect(rec.items[0].lastOpenedAt).toBeTruthy();
    expect((await o("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});

describe("items list / search", () => {
  it("tìm 'ha noi' ra 'Hà Nội' (không dấu, tiền tố, mô tả)", async () => {
    await mk({ type: "doc", title: "Du lịch Hà Nội", description: "Phố cổ" });
    await mk({ type: "doc", title: "Sài Gòn" });
    await mk({ type: "doc", title: "Ghi chú", description: "Đi chơi Hà Nội cuối tuần" });
    for (const q of ["ha noi", "HÀ NỘI", "ha n", "hà nội", "pho co"]) {
      const r = await ls({ q });
      expect(r.items.length, q).toBeGreaterThan(0);
      expect(r.items.some((i: any) => i.title.includes("Hà Nội") || i.description?.includes("Phố cổ")), q).toBe(true);
    }
    expect((await ls({ q: "ha noi" })).items.every((i: any) => !i.title.includes("Sài Gòn"))).toBe(true);
    expect((await ls({ q: "!!!" })).items).toEqual([]);
    expect((await ls({ q: "x'); DROP TABLE item;--" })).items).toEqual([]);
    expect(await prisma.item.count()).toBeGreaterThan(0);
  });

  it("lọc: topic gồm cả con, tag, type, pinned, none, phân trang cursor", async () => {
    const root = await topic("L-Gốc");
    const kid = await topic("L-Con", root);
    const other = await topic("L-Khác");
    const i1 = await jsonOf(await mk({ type: "doc", title: "L-1", topicId: root, tags: ["lt"] }));
    const i2 = await jsonOf(await mk({ type: "tool", title: "L-2", topicId: kid }));
    const i3 = await jsonOf(await mk({ type: "doc", title: "L-3", topicId: other }));
    const free = await jsonOf(await mk({ type: "doc", title: "L-free" }));
    const ids = async (q: Record<string, string>) => (await ls(q)).items.map((i: any) => i.id);
    expect((await ids({ topic: root })).sort()).toEqual([i1.id, i2.id].sort());
    expect(await ids({ topic: kid })).toEqual([i2.id]);
    expect(await ids({ topic: root, tag: "lt" })).toEqual([i1.id]);
    expect(await ids({ topic: root, type: "tool" })).toEqual([i2.id]);
    expect(await ids({ topic: "none", q: "free" })).toEqual([free.id]);
    await call(patch, `/api/items/${i3.id}`, { method: "PATCH", cookie: s.cookie, params: { id: i3.id }, body: { pinned: true } });
    expect(await ids({ topic: other, pinned: "1" })).toEqual([i3.id]);
    // phân trang
    const p1 = await ls({ topic: root, limit: "1" });
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await ls({ topic: root, limit: "1", cursor: p1.nextCursor });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
    expect((await call(list, "/api/items", { cookie: s.cookie, query: { cursor: "zzz" } })).status).toBe(422);
    expect((await call(list, "/api/items", { cookie: s.cookie, query: { topic: "bad" } })).status).toBe(422);
    expect((await call(list, "/api/items", { cookie: s.cookie, query: { limit: "9999" } })).status).toBe(422);
  });

  it("reorder items trong topic", async () => {
    const t = await topic("RO-Item");
    const a = await jsonOf(await mk({ type: "doc", title: "ro-a", topicId: t }));
    const b = await jsonOf(await mk({ type: "doc", title: "ro-b", topicId: t }));
    const c = await jsonOf(await mk({ type: "doc", title: "ro-c", topicId: t }));
    const r = await call(reorder, "/api/items/reorder", { method: "POST", cookie: s.cookie, body: { topicId: t, ids: [c.id, a.id, b.id] } });
    expect(r.status).toBe(204);
    expect((await ls({ topic: t })).items.map((i: any) => i.title)).toEqual(["ro-c", "ro-a", "ro-b"]);
    expect((await call(reorder, "/api/items/reorder", { method: "POST", cookie: s.cookie, body: { topicId: null, ids: [a.id] } })).status).toBe(422);
  });

  it("tags: đếm theo item active", async () => {
    await mk({ type: "doc", title: "tg1", tags: ["Đếm Thử"] });
    const x = await jsonOf(await mk({ type: "doc", title: "tg2", tags: ["Đếm Thử"] }));
    let t = (await jsonOf(await call(tags, "/api/tags", { cookie: s.cookie }))).tags.find((t: any) => t.slug === "dem-thu");
    expect(t.count).toBe(2);
    await call(del, `/api/items/${x.id}`, { method: "DELETE", cookie: s.cookie, params: { id: x.id } });
    t = (await jsonOf(await call(tags, "/api/tags", { cookie: s.cookie }))).tags.find((t: any) => t.slug === "dem-thu");
    expect(t.count).toBe(1);
  });

  it("/api/search gộp item + note + topic", async () => {
    await topic("Hồ Gươm Topic");
    const n = await jsonOf(await mk({ type: "note", title: "Ghi chú lạ" }));
    await prisma.$executeRaw`UPDATE note SET body_md = 'nội dung về Quảng Ninh vịnh' WHERE item_id = ${n.id}::uuid`;
    const sr = (q: string) => call(searchGet, "/api/search", { cookie: s.cookie, query: { q } }).then(jsonOf);
    expect((await sr("quang ninh")).items.map((i: any) => i.id)).toContain(n.id);
    expect((await sr("ho guom")).topics.map((t: any) => t.name)).toContain("Hồ Gươm Topic");
    expect((await sr("")).items).toEqual([]);
    expect((await sr("100%_")).topics).toEqual([]);
  });

  it("buildPrefixQuery", () => {
    expect(buildPrefixQuery("ha  noi!")).toBe("ha:* & noi:*");
    expect(buildPrefixQuery("'; --")).toBeNull();
  });
});

describe("note item", () => {
  it("tạo item note -> có note + note_version v1", async () => {
    const n = await jsonOf(await mk({ type: "note", title: "N1" }));
    const note = await prisma.note.findUnique({ where: { itemId: n.id }, include: { versions: true } });
    expect(note!.currentVersion).toBe(1);
    expect(note!.versions.map((v) => v.version)).toEqual([1]);
  });
});
