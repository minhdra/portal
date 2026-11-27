import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { POST as createItem } from "@/app/api/items/route";
import { GET as getNote, PUT as putNote } from "@/app/api/items/[id]/note/route";
import { GET as versions } from "@/app/api/items/[id]/note/versions/route";
import { GET as versionGet } from "@/app/api/items/[id]/note/versions/[v]/route";
import { POST as restore } from "@/app/api/items/[id]/note/versions/[v]/restore/route";
import { GET as exportMd } from "@/app/api/items/[id]/note/export/route";
import { call, jsonOf, resetData, session } from "./helpers";

let s: Awaited<ReturnType<typeof session>>;
beforeAll(async () => {
  await resetData();
  s = await session();
});

const mkNote = async (title = "Ghi chú Hà Nội") =>
  (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "note", title } }))).id as string;
const put = (id: string, markdown: string, baseVersion: unknown) =>
  call(putNote, `/api/items/${id}/note`, { method: "PUT", cookie: s.cookie, params: { id }, body: { markdown, baseVersion } });
const get = (id: string) => call(getNote, `/api/items/${id}/note`, { cookie: s.cookie, params: { id } });

describe("note", () => {
  it("mới tạo: markdown rỗng, version 1, có note_version v1", async () => {
    const id = await mkNote();
    const r = await get(id);
    expect(r.status).toBe(200);
    expect(await jsonOf(r)).toMatchObject({ markdown: "", version: 1 });
    const vs = (await jsonOf(await call(versions, "", { cookie: s.cookie, params: { id } }))).versions;
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ version: 1, size: 0, author: "Tester" });
    expect(vs[0].createdAt).toBeTruthy();
  });

  it("PUT tăng version; baseVersion lệch -> 409 + currentVersion; không ghi đè", async () => {
    const id = await mkNote();
    const a = await put(id, "# Một", 1);
    expect(a.status).toBe(200);
    expect(await jsonOf(a)).toEqual({ version: 2 });
    const stale = await put(id, "# Cũ ghi đè", 1);
    expect(stale.status).toBe(409);
    const e = (await jsonOf(stale)).error;
    expect(e.code).toBe("conflict");
    expect(e.currentVersion).toBe(2);
    expect(await jsonOf(await get(id))).toMatchObject({ markdown: "# Một", version: 2 });
    expect(await jsonOf(await put(id, "# Hai", 2))).toEqual({ version: 3 });
    const note = await prisma.note.findUniqueOrThrow({ where: { itemId: id }, include: { versions: { orderBy: { version: "asc" } } } });
    expect(note.currentVersion).toBe(3);
    expect(note.versions.map((v) => [v.version, v.bodyMd])).toEqual([[1, ""], [2, "# Một"], [3, "# Hai"]]);
  });

  it("hai PUT đồng thời cùng baseVersion: đúng một thắng, không trùng/mất version", async () => {
    const id = await mkNote();
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => put(id, `bản ${i}`, 1)));
    const codes = rs.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    const note = await prisma.note.findUniqueOrThrow({ where: { itemId: id }, include: { versions: true } });
    expect(note.currentVersion).toBe(2);
    expect(note.versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("validation: thiếu baseVersion, baseVersion sai kiểu, quá dài", async () => {
    const id = await mkNote();
    expect((await put(id, "x", undefined)).status).toBe(422);
    expect((await put(id, "x", "1")).status).toBe(422);
    expect((await put(id, "x", 0)).status).toBe(422);
    expect((await put(id, "x".repeat(1_000_001), 1)).status).toBe(422);
  });

  it("lịch sử: danh sách giảm dần, xem một bản, 404 bản lạ, restore tạo bản mới", async () => {
    const id = await mkNote();
    await put(id, "một", 1);
    await put(id, "hai hai", 2);
    const vs = (await jsonOf(await call(versions, "", { cookie: s.cookie, params: { id } }))).versions;
    expect(vs.map((v: any) => v.version)).toEqual([3, 2, 1]);
    expect(vs[0].size).toBe(Buffer.byteLength("hai hai"));
    const v2 = await call(versionGet, "", { cookie: s.cookie, params: { id, v: "2" } });
    expect(await jsonOf(v2)).toMatchObject({ version: 2, markdown: "một", author: "Tester" });
    expect((await call(versionGet, "", { cookie: s.cookie, params: { id, v: "99" } })).status).toBe(404);
    expect((await call(versionGet, "", { cookie: s.cookie, params: { id, v: "abc" } })).status).toBe(404);
    const rs = await call(restore, "", { method: "POST", cookie: s.cookie, params: { id, v: "2" } });
    expect(rs.status).toBe(200);
    expect(await jsonOf(rs)).toEqual({ version: 4 });
    expect(await jsonOf(await get(id))).toMatchObject({ markdown: "một", version: 4 });
    // bản cũ bất biến
    expect((await jsonOf(await call(versionGet, "", { cookie: s.cookie, params: { id, v: "3" } }))).markdown).toBe("hai hai");
    expect((await call(restore, "", { method: "POST", cookie: s.cookie, params: { id, v: "77" } })).status).toBe(404);
  });

  it("export md: attachment, nosniff, nội dung đúng; format khác -> 422", async () => {
    const id = await mkNote("Ghi chú Hà Nội");
    await put(id, "# Xin chào\n<script>x</script>", 1);
    const r = await call(exportMd, "", { cookie: s.cookie, params: { id }, query: { format: "md" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="ghi-chu-ha-noi\.md"/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await r.text()).toBe("# Xin chào\n<script>x</script>");
    expect((await call(exportMd, "", { cookie: s.cookie, params: { id }, query: { format: "pdf" } })).status).toBe(422);
  });

  it("item không phải note / không tồn tại -> 404; note xoá cứng cùng item", async () => {
    const doc = (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "d" } }))).id;
    expect((await get(doc)).status).toBe(404);
    expect((await put(doc, "x", 1)).status).toBe(404);
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await get("zzz")).status).toBe(404);
  });

  it("đổi type doc -> note tạo note v1 khi cần; yêu cầu chưa đăng nhập bị 401", async () => {
    const { PATCH } = await import("@/app/api/items/[id]/route");
    const doc = (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "sẽ thành note" } }))).id;
    expect((await call(PATCH, "", { method: "PATCH", cookie: s.cookie, params: { id: doc }, body: { type: "note" } })).status).toBe(200);
    expect(await jsonOf(await get(doc))).toMatchObject({ version: 1 });
    expect((await call(getNote, "", { params: { id: doc } })).status).toBe(401);
  });
});
