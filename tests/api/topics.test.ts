import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { GET as list, POST as create } from "@/app/api/topics/route";
import { DELETE as del, PATCH as patch } from "@/app/api/topics/[id]/route";
import { POST as reorder } from "@/app/api/topics/reorder/route";
import { POST as createItem } from "@/app/api/items/route";
import { MAX_DEPTH, wouldCreateCycle } from "@/server/services/topics";
import { call, jsonOf, resetData, session } from "./helpers";

let s: Awaited<ReturnType<typeof session>>;
beforeAll(async () => {
  await resetData();
  s = await session();
});

const mk = async (name: string, parentId?: string | null) => {
  const r = await call(create, "/api/topics", { method: "POST", cookie: s.cookie, body: { name, ...(parentId !== undefined ? { parentId } : {}) } });
  return { r, b: await jsonOf(r) };
};
const upd = (id: string, body: unknown) => call(patch, `/api/topics/${id}`, { method: "PATCH", cookie: s.cookie, params: { id }, body });

describe("topics", () => {
  it("tạo: slug bỏ dấu, chống trùng theo cha; 201 + DTO", async () => {
    const a = await mk("Hà Nội Đẹp");
    expect(a.r.status).toBe(201);
    expect(a.b).toMatchObject({ name: "Hà Nội Đẹp", slug: "ha-noi-dep", parentId: null, itemCount: 0, children: [] });
    const b = await mk("Hà Nội Đẹp");
    expect(b.b.slug).toBe("ha-noi-dep-2");
    const c = await mk("!!!");
    expect(c.b.slug).toBe("muc");
    // cùng tên khác cha thì không cần hậu tố
    const child1 = await mk("Con", a.b.id);
    const child2 = await mk("Con", b.b.id);
    expect(child1.b.slug).toBe("con");
    expect(child2.b.slug).toBe("con");
  });

  it("validation: tên rỗng/quá dài, parent không tồn tại, icon", async () => {
    expect((await mk("   ")).r.status).toBe(422);
    expect((await mk("x".repeat(101))).r.status).toBe(422);
    const bad = await mk("Ổn", "00000000-0000-4000-8000-000000000000");
    expect(bad.r.status).toBe(422);
    expect(bad.b.error.fields.parentId).toBeTruthy();
    expect((await mk("Ổn", "không-phải-uuid")).r.status).toBe(422);
  });

  it("GET trả cây lồng nhau, itemCount chỉ đếm item active", async () => {
    const root = (await mk("Gốc cây")).b;
    const kid = (await mk("Lá", root.id)).b;
    await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "A", topicId: kid.id } });
    const arch = await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "B", topicId: kid.id } }));
    await prisma.item.update({ where: { id: arch.id }, data: { status: "archived" } });
    const tree = (await jsonOf(await call(list, "/api/topics", { cookie: s.cookie }))).topics as any[];
    const r = tree.find((t) => t.id === root.id);
    expect(r.children).toHaveLength(1);
    expect(r.children[0]).toMatchObject({ id: kid.id, itemCount: 1, parentId: root.id });
  });

  it("PATCH: đổi tên (slug mới), icon, chuyển cha; 404 cho id lạ", async () => {
    const a = (await mk("Alpha")).b;
    const b = (await mk("Beta")).b;
    const r = await upd(a.id, { name: "Gamma Mới", icon: "star", parentId: b.id });
    expect(r.status).toBe(200);
    expect(await jsonOf(r)).toMatchObject({ name: "Gamma Mới", slug: "gamma-moi", icon: "star", parentId: b.id });
    expect((await upd(a.id, { parentId: null })).status).toBe(200);
    expect((await upd("00000000-0000-4000-8000-000000000000", { name: "x" })).status).toBe(404);
    expect((await upd("bad-id", { name: "x" })).status).toBe(404);
  });

  it("chặn chu trình: tự làm cha, con làm cha, cháu làm cha -> 409", async () => {
    const a = (await mk("CT-A")).b;
    const b = (await mk("CT-B", a.id)).b;
    const c = (await mk("CT-C", b.id)).b;
    for (const [id, parentId] of [[a.id, a.id], [a.id, b.id], [a.id, c.id], [b.id, c.id]] as const) {
      const r = await upd(id, { parentId });
      expect(r.status, `${id}->${parentId}`).toBe(409);
      expect((await jsonOf(r)).error.code).toBe("conflict");
    }
    expect(await prisma.$transaction((tx) => wouldCreateCycle(tx, a.id, c.id))).toBe(true);
    expect(await prisma.$transaction((tx) => wouldCreateCycle(tx, c.id, a.id))).toBe(false);
    // chuyển hợp lệ: C lên gốc
    expect((await upd(c.id, { parentId: null })).status).toBe(200);
    // sau đó A có thể làm con của C
    expect((await upd(a.id, { parentId: c.id })).status).toBe(200);
  });

  it("giới hạn độ sâu: không tạo được tầng thứ MAX_DEPTH+1 và CTE không lặp vô hạn", async () => {
    let parent: string | null = null;
    for (let i = 1; i <= MAX_DEPTH; i++) {
      const r = await mk(`Sâu ${i}`, parent);
      expect(r.r.status, `tầng ${i}`).toBe(201);
      parent = r.b.id;
    }
    const over = await mk("Quá sâu", parent);
    expect(over.r.status).toBe(409);
  });

  it("DB vẫn chặn tự làm cha (CHECK) dù ứng dụng bị bỏ qua", async () => {
    const a = (await mk("DB-A")).b;
    await expect(prisma.$executeRaw`UPDATE topic SET parent_id = id WHERE id = ${a.id}::uuid`).rejects.toThrow();
  });

  it("xoá: còn con/item -> 409; rỗng -> 204", async () => {
    const p = (await mk("Xoá-P")).b;
    const k = (await mk("Xoá-K", p.id)).b;
    const d = (a: string) => call(del, `/api/topics/${a}`, { method: "DELETE", cookie: s.cookie, params: { id: a } });
    expect((await d(p.id)).status).toBe(409);
    await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: "giữ", topicId: k.id } });
    expect((await d(k.id)).status).toBe(409);
    await prisma.item.deleteMany({ where: { topicId: k.id } });
    expect((await d(k.id)).status).toBe(204);
    expect((await d(p.id)).status).toBe(204);
    expect((await d(p.id)).status).toBe(404);
  });

  it("reorder: đặt thứ tự; từ chối id khác cha / trùng", async () => {
    const p = (await mk("RO-P")).b;
    const x = (await mk("X", p.id)).b;
    const y = (await mk("Y", p.id)).b;
    const z = (await mk("Z", p.id)).b;
    const ro = (parentId: string | null, ids: string[]) => call(reorder, "/api/topics/reorder", { method: "POST", cookie: s.cookie, body: { parentId, ids } });
    expect((await ro(p.id, [z.id, x.id, y.id])).status).toBe(204);
    const tree = (await jsonOf(await call(list, "/api/topics", { cookie: s.cookie }))).topics as any[];
    expect(tree.find((t) => t.id === p.id).children.map((c: any) => c.name)).toEqual(["Z", "X", "Y"]);
    expect((await ro(null, [x.id])).status).toBe(422);
    expect((await ro(p.id, [x.id, x.id])).status).toBe(422);
    expect((await ro(p.id, ["bad"])).status).toBe(422);
  });
});
