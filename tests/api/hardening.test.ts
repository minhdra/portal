import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as changePw } from "@/app/api/auth/change-password/route";
import { POST as createItem } from "@/app/api/items/route";
import { POST as createTopic } from "@/app/api/topics/route";
import { POST as reorderItems } from "@/app/api/items/reorder/route";
import { POST as reorderTopics } from "@/app/api/topics/reorder/route";
import { POST as upload } from "@/app/api/items/[id]/files/route";
import { GET as view } from "@/app/api/files/[id]/view/route";
import { GET as getNote, PUT as putNote } from "@/app/api/items/[id]/note/route";
import { USER_FREE_FAILS } from "@/server/services/auth";
import { MAX_NOTE_VERSIONS } from "@/server/services/notes";
import { MAX_ZIP_UNCOMPRESSED, assertZipSane, runViewWorker } from "@/server/services/view";
import { PNG, EXE, makeDocx, makeXlsx } from "./fixtures";
import { call, freshIp, jsonOf, loginCookie, makeUser, resetData, rnd, session } from "./helpers";

let s: Awaited<ReturnType<typeof session>>;
beforeAll(async () => {
  await resetData();
  s = await session();
});
afterEach(() => vi.unstubAllEnvs());

const tryLogin = (username: string, password: string, ip: string) =>
  call(login, "/api/auth/login", { method: "POST", body: { username, password }, ip });

describe("M1: rate limit đăng nhập không check-then-act", () => {
  it("200 login sai song song cùng (user, ip): đúng 5 lần đoán được xử lý", async () => {
    const u = await makeUser();
    const ip = freshIp();
    const rs = await Promise.all(Array.from({ length: 200 }, () => tryLogin(u.username, "sai-sai-sai-sai", ip)));
    const count = (st: number) => rs.filter((r) => r.status === st).length;
    expect(count(401)).toBe(5);
    expect(count(429)).toBe(195);
    expect(await prisma.loginAttempt.count({ where: { username: u.username, ip, kind: "login" } })).toBe(5);
    // mật khẩu đúng bị chặn cho tới hết cửa sổ
    expect((await tryLogin(u.username, u.password, ip)).status).toBe(429);
  });

  it("200 login song song từ 200 IP khác nhau: tổng số lần đoán theo username bị chặn (backoff), không phải 200", async () => {
    const u = await makeUser();
    const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => tryLogin(u.username, "sai-sai-sai-sai", `198.51.${i % 250}.${(i * 7) % 250}`)));
    const guesses = rs.filter((r) => r.status === 401).length;
    expect(guesses).toBeLessThanOrEqual(USER_FREE_FAILS + 1);
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(200 - USER_FREE_FAILS - 1);
  });

  it("đúng mật khẩu song song vẫn 200 (đặt chỗ được đổi thành success), không để lại lần sai", async () => {
    const u = await makeUser();
    const ip = freshIp();
    const rs = await Promise.all(Array.from({ length: 4 }, () => tryLogin(u.username, u.password, ip)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await prisma.loginAttempt.count({ where: { username: u.username, success: false } })).toBe(0);
  });

  it("khoá đổi mật khẩu tách bằng cột kind: không trộn với đăng nhập cùng username", async () => {
    const u = await makeUser();
    const cookie = await loginCookie(u.username, u.password);
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const r = await call(changePw, "/api/auth/change-password", { method: "POST", cookie, ip, body: { currentPassword: "sai-sai-sai-sai", newPassword: "mat-khau-moi-123" } });
      expect(r.status).toBe(422);
    }
    const blocked = await call(changePw, "/api/auth/change-password", { method: "POST", cookie, ip, body: { currentPassword: u.password, newPassword: "mat-khau-moi-123" } });
    expect(blocked.status).toBe(429);
    // đăng nhập cùng username + ip không bị ảnh hưởng, và hàng ghi đúng kind/username
    expect((await tryLogin(u.username, u.password, ip)).status).toBe(200);
    expect(await prisma.loginAttempt.count({ where: { kind: "cp", username: u.username, ip } })).toBe(5);
    expect(await prisma.loginAttempt.count({ where: { username: `cp:${u.username}` } })).toBe(0);
    // và ngược lại: 5 lần sai đăng nhập không khoá đổi mật khẩu
    const u2 = await makeUser();
    const c2 = await loginCookie(u2.username, u2.password);
    const ip2 = freshIp();
    for (let i = 0; i < 5; i++) await tryLogin(u2.username, "sai-sai-sai-sai", ip2);
    const ok = await call(changePw, "/api/auth/change-password", { method: "POST", cookie: c2, ip: ip2, body: { currentPassword: u2.password, newPassword: "mat-khau-moi-123" } });
    expect(ok.status).toBe(204);
  });
});

describe("M2: giới hạn theo username là backoff, không khoá vĩnh viễn", () => {
  it("quá ngưỡng -> 429 + Retry-After; IP quen (đã có phiên) được miễn; hết backoff thì thử lại được", async () => {
    const u = await makeUser();
    const home = freshIp();
    await loginCookie(u.username, u.password, home); // tạo phiên từ IP quen
    for (let i = 0; i < USER_FREE_FAILS; i++) expect((await tryLogin(u.username, "sai-sai-sai-sai", freshIp())).status).toBe(401);
    const stranger = await tryLogin(u.username, u.password, freshIp());
    expect(stranger.status).toBe(429);
    expect(Number(stranger.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // người lạ không khoá được chủ tài khoản đang ở IP quen
    expect((await tryLogin(u.username, u.password, home)).status).toBe(200);
    // sau khoảng nghỉ (lùi mốc thời gian), cả IP lạ cũng thử lại được
    await prisma.$executeRaw`UPDATE login_attempt SET created_at = created_at - interval '2 minutes' WHERE username = ${u.username}`;
    expect((await tryLogin(u.username, u.password, freshIp())).status).toBe(200);
  });
});

describe("M4: cookie Secure ghim + __Host-", () => {
  it("COOKIE_SECURE=1: Secure dù X-Forwarded-Proto=http, tên __Host-, phiên đọc lại được", async () => {
    vi.stubEnv("COOKIE_SECURE", "1");
    const u = await makeUser();
    const r = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password }, headers: { "x-forwarded-proto": "http" } });
    expect(r.status).toBe(200);
    const sc = r.headers.get("set-cookie")!;
    expect(sc).toMatch(/^__Host-portal_session=/);
    expect(sc).toMatch(/; Secure/);
    expect(sc).toMatch(/Path=\//);
    expect(sc).not.toMatch(/Domain/i);
    const cookie = sc.split(";")[0]!;
    expect((await call(me, "/api/auth/me", { cookie })).status).toBe(200);
    expect((await call(me, "/api/auth/me", { cookie: cookie.replace("__Host-", "") })).status).toBe(401);
  });
  it("dev http (không ghim): cookie thường, không Secure", async () => {
    const u = await makeUser();
    const r = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password } });
    expect(r.headers.get("set-cookie")).toMatch(/^portal_session=/);
    expect(r.headers.get("set-cookie")).not.toMatch(/Secure/);
  });
});

describe("L2: hạn tuyệt đối của phiên", () => {
  it("phiên mới có hạn tuyệt đối ~60 ngày; quá hạn tuyệt đối -> 401; gia hạn trượt không vượt hạn tuyệt đối", async () => {
    const u = await makeUser();
    const cookie = await loginCookie(u.username, u.password);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    const days = (row.absoluteExpiresAt.getTime() - row.createdAt.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
    // sắp hết hạn tuyệt đối: trượt bị chặn ở mốc tuyệt đối
    const abs = new Date(Date.now() + 3600_000);
    await prisma.session.update({ where: { id: row.id }, data: { absoluteExpiresAt: abs, lastSeenAt: new Date(Date.now() - 3600_000) } });
    expect((await call(me, "/api/auth/me", { cookie })).status).toBe(200);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(abs.getTime());
    // quá hạn tuyệt đối dù expires_at còn xa
    await prisma.session.update({ where: { id: row.id }, data: { absoluteExpiresAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 86_400_000) } });
    expect((await call(me, "/api/auth/me", { cookie })).status).toBe(401);
  });
});

// ---------- upload / view ----------
const up = (id: string, files: { name: string; data: Buffer }[]) => {
  const form = new FormData();
  for (const f of files) form.append("file", new File([new Uint8Array(f.data)], f.name));
  return call(upload, `/api/items/${id}/files`, { method: "POST", cookie: s.cookie, params: { id }, form });
};
const mkDoc = async () =>
  (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: `d-${rnd()}` } }))).id as string;
const blobs = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? blobs(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];
const viewOf = (id: string) => call(view, `/api/files/${id}/view`, { cookie: s.cookie, params: { id } });

describe("L3: upload kiểm tra cả lô trước khi ghi", () => {
  it("lô [png hợp lệ, exe] -> 415 và không ghi blob/hàng nào", async () => {
    const id = await mkDoc();
    const before = blobs(process.env.UPLOAD_DIR!).length;
    const r = await up(id, [{ name: "ok.png", data: PNG }, { name: "bad.png", data: EXE }]);
    expect(r.status).toBe(415);
    expect(await prisma.file.count({ where: { itemId: id } })).toBe(0);
    expect(blobs(process.env.UPLOAD_DIR!).length).toBe(before);
  });
});

describe("L4: unique (item_id, sha256)", () => {
  it("10 upload song song cùng nội dung -> đúng 1 hàng, còn lại duplicate:true", async () => {
    const id = await mkDoc();
    const data = Buffer.concat([PNG, Buffer.from(rnd(8))]);
    const rs = await Promise.all(Array.from({ length: 10 }, () => up(id, [{ name: "a.png", data }])));
    const bodies = await Promise.all(rs.map((r) => jsonOf(r)));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await prisma.file.count({ where: { itemId: id } })).toBe(1);
    expect(new Set(bodies.map((b) => b.files[0].id)).size).toBe(1);
    expect(bodies.filter((b) => b.files[0].duplicate).length).toBe(9);
    expect(blobs(process.env.UPLOAD_DIR!).length).toBeGreaterThanOrEqual(1);
  });
  it("DB từ chối hàng trùng", async () => {
    const id = await mkDoc();
    await up(id, [{ name: "a.png", data: PNG }]);
    const r = await prisma.file.findFirstOrThrow({ where: { itemId: id } });
    await expect(prisma.file.create({ data: { itemId: id, storageKey: `x/${rnd()}`, originalName: "b", mime: r.mime, size: r.size, sha256: r.sha256 } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("M5: xem docx/xlsx trong worker có trần", () => {
  const bomb = async (declared: boolean) => {
    const z = await JSZip.loadAsync(await makeDocx(["x"]));
    z.file("word/junk.bin", Buffer.alloc(MAX_ZIP_UNCOMPRESSED + 30 * 1024 * 1024)); // ~80 MB toàn số 0, nén còn ~80 KB
    const buf = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    expect(buf.length).toBeLessThan(2 * 1024 * 1024);
    if (!declared) return buf;
    // khai sai kích thước giải nén trong central directory
    const name = Buffer.from("word/junk.bin");
    let off = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    for (;;) {
      const nl = buf.readUInt16LE(off + 28);
      if (buf.subarray(off + 46, off + 46 + nl).equals(name)) break;
      off += 46 + nl + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
    }
    buf.writeUInt32LE(1000, off + 24);
    return buf;
  };

  it("zip bomb khai kích thước nhỏ: qua được lọc central directory nhưng bị worker chặn 413", async () => {
    const buf = await bomb(true);
    expect(() => assertZipSane(buf)).not.toThrow(); // chứng minh kích thước khai báo thật sự đánh lừa lớp lọc cũ
    const id = await mkDoc();
    const up1 = await up(id, [{ name: "bomb.docx", data: buf }]);
    expect(up1.status).toBe(201);
    const fid = (await jsonOf(up1)).files[0].id;
    const r = await viewOf(fid);
    expect(r.status).toBe(413);
  });

  it("zip bomb khai đúng: 413 ngay ở lọc khai báo", async () => {
    const id = await mkDoc();
    const fid = (await jsonOf(await up(id, [{ name: "bomb2.docx", data: await bomb(false) }]))).files[0].id;
    expect((await viewOf(fid)).status).toBe(413);
  });

  it("tệp > 10 MB: 413", async () => {
    const z = await JSZip.loadAsync(await makeDocx(["x"]));
    z.file("word/pad.bin", Buffer.from(Array.from({ length: 11 * 1024 * 1024 }, (_, i) => (i * 2654435761) >>> 24)), { compression: "STORE" });
    const id = await mkDoc();
    const fid = (await jsonOf(await up(id, [{ name: "big.docx", data: await z.generateAsync({ type: "nodebuffer", compression: "STORE" }) }]))).files[0].id;
    expect((await viewOf(fid)).status).toBe(413);
  });

  it("worker treo: terminate sau timeout -> 422", async () => {
    const t0 = Date.now();
    await expect(runViewWorker({}, { source: "while (true) {}", timeoutMs: 300 })).rejects.toMatchObject({ status: 422 });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("worker ngốn heap vượt resourceLimits -> 413", async () => {
    await expect(
      runViewWorker({}, { source: "const a = []; for (;;) a.push(new Array(1e5).fill('x'.repeat(50)));", resourceLimits: { maxOldGenerationSizeMb: 32 }, timeoutMs: 8000 }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("docx và xlsx hợp lệ vẫn xem được", async () => {
    const id = await mkDoc();
    const d = (await jsonOf(await up(id, [{ name: "a.docx", data: await makeDocx(["Xin chào Hà Nội"]) }]))).files[0].id;
    const x = (await jsonOf(await up(id, [{ name: "a.xlsx", data: await makeXlsx([["a", "b"], ["1", "2"]]) }]))).files[0].id;
    const rd = await jsonOf(await viewOf(d));
    expect(rd.kind).toBe("html");
    expect(rd.html).toContain("Xin chào Hà Nội");
    const rx = await jsonOf(await viewOf(x));
    expect(rx.sheets[0].rows).toEqual([["a", "b"], ["1", "2"]]);
  });
});

// ---------- note ----------
const mkNoteRow = async () => (await prisma.item.create({ data: { type: "note", title: `n-${rnd()}` } })).id;
const getN = (id: string) => call(getNote, `/api/items/${id}/note`, { cookie: s.cookie, params: { id } });
const putN = (id: string, markdown: string, baseVersion: number) =>
  call(putNote, `/api/items/${id}/note`, { method: "PUT", cookie: s.cookie, params: { id }, body: { markdown, baseVersion } });

describe("L5: ensureNote an toàn khi đua", () => {
  it("20 GET song song trên item note chưa có hàng note: đều 200, đúng 1 note + 1 version", async () => {
    const id = await mkNoteRow();
    const rs = await Promise.all(Array.from({ length: 20 }, () => getN(id)));
    expect(rs.map((r) => r.status)).toEqual(Array(20).fill(200));
    const note = await prisma.note.findUniqueOrThrow({ where: { itemId: id }, include: { versions: true } });
    expect(note.versions).toHaveLength(1);
  });
  it("GET khi note đã có không ghi gì", async () => {
    const id = await mkNoteRow();
    await getN(id);
    const n1 = await prisma.note.findUniqueOrThrow({ where: { itemId: id } });
    await getN(id);
    await getN(id);
    const n2 = await prisma.note.findUniqueOrThrow({ where: { itemId: id } });
    expect(n2.updatedAt).toEqual(n1.updatedAt);
    expect(await prisma.noteVersion.count({ where: { noteId: n1.id } })).toBe(1);
  });
});

describe("L6: NUL và giới hạn phiên bản", () => {
  it("markdown chứa NUL -> 422 (không 500)", async () => {
    const id = await mkNoteRow();
    const r = await putN(id, "abc\u0000def", 1);
    expect(r.status).toBe(422);
    expect((await jsonOf(r)).error.code).toBe("validation");
  });
  it(`chỉ giữ ${MAX_NOTE_VERSIONS} phiên bản mới nhất`, async () => {
    const id = await mkNoteRow();
    await getN(id);
    const total = MAX_NOTE_VERSIONS + 5;
    for (let v = 1; v <= total; v++) expect((await putN(id, `v${v}`, v)).status).toBe(200);
    const note = await prisma.note.findUniqueOrThrow({ where: { itemId: id } });
    expect(note.currentVersion).toBe(total + 1);
    const vs = await prisma.noteVersion.findMany({ where: { noteId: note.id }, orderBy: { version: "asc" } });
    expect(vs).toHaveLength(MAX_NOTE_VERSIONS);
    expect(vs[0]!.version).toBe(total + 1 - MAX_NOTE_VERSIONS + 1);
    expect(vs.at(-1)!.version).toBe(total + 1);
  }, 120_000);
});

// ---------- reorder ----------
describe("L7: reorder phải là đúng tập anh em", () => {
  const mkTopic = async (name: string, parentId?: string) =>
    (await jsonOf(await call(createTopic, "/api/topics", { method: "POST", cookie: s.cookie, body: { name: `${name}-${rnd()}`, parentId } }))).id as string;
  const mkItem = async (topicId: string) =>
    (await jsonOf(await call(createItem, "/api/items", { method: "POST", cookie: s.cookie, body: { type: "doc", title: `i-${rnd()}`, topicId } }))).id as string;
  const ro = (h: any, path: string, body: unknown) => call(h, path, { method: "POST", cookie: s.cookie, body });

  it("topic: thiếu -> 422, thừa (khác cha) -> 422, đủ -> 204", async () => {
    const p = await mkTopic("P");
    const [a, b, c] = [await mkTopic("a", p), await mkTopic("b", p), await mkTopic("c", p)];
    const other = await mkTopic("o");
    expect((await ro(reorderTopics, "/api/topics/reorder", { parentId: p, ids: [c, a] })).status).toBe(422);
    expect((await ro(reorderTopics, "/api/topics/reorder", { parentId: p, ids: [c, a, b, other] })).status).toBe(422);
    expect((await ro(reorderTopics, "/api/topics/reorder", { parentId: p, ids: [] })).status).toBe(422);
    expect((await ro(reorderTopics, "/api/topics/reorder", { parentId: p, ids: [c, a, b] })).status).toBe(204);
  });
  it("item: thiếu -> 422, thừa -> 422, đủ -> 204", async () => {
    const t = await mkTopic("T");
    const [a, b, c] = [await mkItem(t), await mkItem(t), await mkItem(t)];
    const t2 = await mkTopic("T2");
    const x = await mkItem(t2);
    expect((await ro(reorderItems, "/api/items/reorder", { topicId: t, ids: [b] })).status).toBe(422);
    expect((await ro(reorderItems, "/api/items/reorder", { topicId: t, ids: [a, b, c, x] })).status).toBe(422);
    expect((await ro(reorderItems, "/api/items/reorder", { topicId: t, ids: [c, b, a] })).status).toBe(204);
  });
});
