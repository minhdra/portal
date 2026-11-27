import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as changePw } from "@/app/api/auth/change-password/route";
import { POST as createItem } from "@/app/api/items/route";
import { POST as createTopic } from "@/app/api/topics/route";
import { POST as reorderItems } from "@/app/api/items/reorder/route";
import { POST as reorderTopics } from "@/app/api/topics/reorder/route";
import { POST as upload } from "@/app/api/items/[id]/files/route";
import { GET as view } from "@/app/api/files/[id]/view/route";
import { GET as serve } from "@/app/api/files/[id]/route";
import { GET as getNote, PUT as putNote } from "@/app/api/items/[id]/note/route";
import { USER_FREE_FAILS } from "@/server/services/auth";
import { MAX_NOTE_VERSIONS } from "@/server/services/notes";
import { MAX_VIEW_HTML, MAX_XLSX_CHARS, MAX_ZIP_UNCOMPRESSED, assertZipSane, runViewWorker } from "@/server/services/view";
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
    const blobsBefore = blobs(process.env.UPLOAD_DIR!).length;
    const rs = await Promise.all(Array.from({ length: 10 }, () => up(id, [{ name: "a.png", data }])));
    const bodies = await Promise.all(rs.map((r) => jsonOf(r)));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await prisma.file.count({ where: { itemId: id } })).toBe(1);
    expect(new Set(bodies.map((b) => b.files[0].id)).size).toBe(1);
    expect(bodies.filter((b) => b.files[0].duplicate).length).toBe(9);
    // bản thua đua xoá blob của mình: trên đĩa chỉ tăng đúng 1 blob (không mồ côi)
    expect(blobs(process.env.UPLOAD_DIR!).length).toBe(blobsBefore + 1);
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
  it("item: bản nháp thuộc tập anh em (phải có mặt); mục đã lưu trữ bị loại (có mặt -> 422)", async () => {
    const t = await mkTopic("T3");
    const [a, b] = [await mkItem(t), await mkItem(t)];
    const draft = await mkItem(t);
    const archived = await mkItem(t);
    await prisma.item.update({ where: { id: draft }, data: { status: "draft" } });
    await prisma.item.update({ where: { id: archived }, data: { status: "archived" } });
    // thiếu bản nháp -> 422
    expect((await ro(reorderItems, "/api/items/reorder", { topicId: t, ids: [a, b] })).status).toBe(422);
    // thêm mục lưu trữ -> 422
    expect((await ro(reorderItems, "/api/items/reorder", { topicId: t, ids: [a, b, draft, archived] })).status).toBe(422);
    // đúng tập (nháp có, lưu trữ không) -> 204 và thứ tự áp dụng
    expect((await ro(reorderItems, "/api/items/reorder", { topicId: t, ids: [draft, b, a] })).status).toBe(204);
    const rows = await prisma.item.findMany({ where: { id: { in: [a, b, draft, archived] } }, select: { id: true, sortOrder: true } });
    const ord = (id: string) => rows.find((r) => r.id === id)!.sortOrder;
    expect(ord(draft)).toBeLessThan(ord(b));
    expect(ord(b)).toBeLessThan(ord(a));
  });
});

// ---------- vòng 2 ----------
describe("M4b: logout xoá cookie __Host-", () => {
  it("COOKIE_SECURE=1: Set-Cookie xoá đúng tên __Host-portal_session (Max-Age=0, Secure, Path=/, không Domain) và phiên mất", async () => {
    vi.stubEnv("COOKIE_SECURE", "1");
    const u = await makeUser();
    const cookie = await loginCookie(u.username, u.password);
    expect(cookie).toMatch(/^__Host-portal_session=/);
    const r = await call(logout, "/api/auth/logout", { method: "POST", cookie });
    expect(r.status).toBe(204);
    const sc = r.headers.get("set-cookie")!;
    expect(sc).toMatch(/^__Host-portal_session=;/);
    expect(sc).toMatch(/Max-Age=0/);
    expect(sc).toMatch(/; Secure/);
    expect(sc).toMatch(/Path=\//);
    expect(sc).not.toMatch(/Domain/i);
    expect((await call(me, "/api/auth/me", { cookie })).status).toBe(401);
  });
});

describe("F2: TRUST_PROXY tắt không khoá toàn cục", () => {
  it("IP 'unknown': 40 người dùng khác nhau sai mật khẩu không khoá ai (không có khoá cứng theo IP); chỉ còn backoff theo username", async () => {
    vi.stubEnv("TRUST_PROXY", "");
    const innocent = await makeUser();
    for (let i = 0; i < 40; i++) expect((await tryLogin(`nobody-${rnd()}`, "sai-sai-sai-sai", "1.2.3.4")).status).toBe(401);
    expect((await tryLogin(innocent.username, innocent.password, "1.2.3.4")).status).toBe(200);
    expect(await prisma.loginAttempt.count({ where: { ip: "unknown", username: innocent.username, success: true } })).toBe(1);
  });
  it("IP 'unknown': không có khoá cứng theo cặp, nhưng vẫn bị làm chậm theo username và không miễn theo IP phiên", async () => {
    vi.stubEnv("TRUST_PROXY", "");
    const u = await makeUser();
    await loginCookie(u.username, u.password); // phiên ghi ip 'unknown' không được coi là IP quen
    for (let i = 0; i < USER_FREE_FAILS; i++) expect((await tryLogin(u.username, "sai-sai-sai-sai", "9.9.9.9")).status).toBe(401);
    const r = await tryLogin(u.username, u.password, "9.9.9.9");
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});

describe("F3: cookie thiết bị quen miễn backoff theo username", () => {
  const device = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith("portal_device="))!.split(";")[0]!;
  it("đăng nhập đúng đặt cookie HttpOnly đã ký; ở IP mới bị dò thì có cookie -> 200, không có -> 429; cookie của user khác/giả không có tác dụng", async () => {
    const u = await makeUser();
    const first = await tryLogin(u.username, u.password, freshIp());
    expect(first.status).toBe(200);
    const sc = first.headers.getSetCookie().find((c) => c.startsWith("portal_device="))!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    const dev = device(first);
    for (let i = 0; i < USER_FREE_FAILS; i++) await tryLogin(u.username, "sai-sai-sai-sai", freshIp());
    const withCookie = (cookie: string | null) =>
      call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password }, ip: freshIp(), cookie });
    expect((await withCookie(null)).status).toBe(429);
    expect((await withCookie(`${dev.slice(0, -3)}AAA`)).status).toBe(429); // chữ ký sai
    const other = await makeUser();
    const otherDev = device(await tryLogin(other.username, other.password, freshIp()));
    expect((await withCookie(otherDev)).status).toBe(429); // cookie của user khác
    expect((await withCookie(dev)).status).toBe(200);
  });
  it("cookie không miễn khoá cứng theo cặp (username, ip)", async () => {
    const u = await makeUser();
    const dev = device(await tryLogin(u.username, u.password, freshIp()));
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await tryLogin(u.username, "sai-sai-sai-sai", ip);
    const r = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password }, ip, cookie: dev });
    expect(r.status).toBe(429);
  });
  it("thiếu SESSION_SECRET: không cấp cookie", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const u = await makeUser();
    const r = await tryLogin(u.username, u.password, freshIp());
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie().some((c) => c.includes("portal_device="))).toBe(false);
  });
});

describe("F4: finishAttempt đúng lúc, 429 của cổng argon2 không tính lần sai", () => {
  it("đổi mật khẩu: mật khẩu hiện tại đúng nhưng mới trùng cũ -> 422 và không để lại lần sai (gửi 8 lần vẫn không 429)", async () => {
    const u = await makeUser();
    const cookie = await loginCookie(u.username, u.password);
    const ip = freshIp();
    for (let i = 0; i < 8; i++) {
      const r = await call(changePw, "/api/auth/change-password", { method: "POST", cookie, ip, body: { currentPassword: u.password, newPassword: u.password + "" } });
      expect(r.status).toBe(422);
    }
    expect(await prisma.loginAttempt.count({ where: { kind: "cp", username: u.username, success: false } })).toBe(0);
  });
  it("400 login song song: các lượt bị cổng argon2 từ chối (429 'bận') không để lại hàng sai; số hàng sai = số 401", async () => {
    const tag = `busy${rnd(4)}`;
    const rs = await Promise.all(
      Array.from({ length: 400 }, (_, i) => tryLogin(`${tag}-${i}`, "sai-sai-sai-sai", `203.0.${(i >> 8) & 255}.${i & 255}`)),
    );
    const bodies = await Promise.all(rs.map(async (r) => (r.status === 429 ? ((await jsonOf(r)).error.message as string) : "")));
    const busy = bodies.filter((m) => m.includes("bận")).length;
    const ok401 = rs.filter((r) => r.status === 401).length;
    expect(busy).toBeGreaterThan(0); // nếu 0: máy quá nhanh hoặc cổng đã đổi, test không còn kiểm được điều cần kiểm
    expect(ok401 + busy).toBe(400);
    expect(await prisma.loginAttempt.count({ where: { username: { startsWith: `${tag}-` }, success: false } })).toBe(ok401);
  }, 120_000);
});

describe("F5: xlsx có ngân sách tổng ký tự và số ô", () => {
  const upX = async (rows: string[][]) => {
    const id = await mkDoc();
    const r = await up(id, [{ name: `big-${rnd()}.xlsx`, data: await makeXlsx(rows) }]);
    expect(r.status).toBe(201);
    return (await jsonOf(r)).files[0].id as string;
  };
  it("nhiều ô lặp một shared string 2000 ký tự -> tổng ký tự <= ngân sách, truncated", async () => {
    const long = "x".repeat(2500);
    const rows = Array.from({ length: 800 }, () => Array.from({ length: 100 }, () => long)); // 80k ô x 2000 = 160 MB nếu không có ngân sách
    const r = await viewOf(await upX(rows));
    expect(r.status).toBe(200);
    const b = await jsonOf(r);
    const total = b.sheets.reduce((n: number, sh: any) => n + sh.rows.reduce((m: number, row: string[]) => m + row.reduce((k, c) => k + c.length, 0), 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_XLSX_CHARS);
    expect(total).toBeGreaterThan(MAX_XLSX_CHARS - 2000 * 100); // cắt ở ranh giới dòng
    expect(b.sheets[0].truncated).toBe(true);
  }, 60_000);
  it("đếm ô trong worker: vượt maxCells -> cắt đúng số ô, truncated (kể cả ô trống đệm)", async () => {
    const buf = await makeXlsx(Array.from({ length: 50 }, () => Array.from({ length: 40 }, () => "a")));
    const base = { kind: "xlsx", buf: new Uint8Array(buf), base: `${process.cwd()}/noop.js`, maxEntries: 5000, maxUncompressed: MAX_ZIP_UNCOMPRESSED, maxHtml: 1e6, maxRows: 2000, maxCols: 500, maxChars: 1e9, maxSheets: 50 };
    const count = (r: any) => r.sheets.reduce((n: number, sh: any) => n + sh.rows.reduce((m: number, row: string[]) => m + row.length, 0), 0);
    const cut = (await runViewWorker({ ...base, maxCells: 1000 })) as any;
    expect(count(cut)).toBe(1000);
    expect(cut.sheets[0].truncated).toBe(true);
    const full = (await runViewWorker({ ...base, maxCells: 2000 })) as any;
    expect(count(full)).toBe(2000);
    expect(full.sheets[0].truncated).toBe(false);
  }, 60_000);
});

describe("F6: lọc HTML docx chạy trong worker", () => {
  it("HTML lồng thẻ cực sâu (bậc hai trong sanitize-html) bị cắt bởi timeout worker, không treo luồng chính", async () => {
    const t0 = Date.now();
    let tick = 0;
    const iv = setInterval(() => tick++, 20); // luồng chính vẫn chạy trong lúc worker bận
    await expect(runViewWorker({ kind: "sanitize", html: "<span>".repeat(300_000), base: `${process.cwd()}/noop.js`, maxHtml: MAX_VIEW_HTML }, { timeoutMs: 1500 })).rejects.toMatchObject({ status: 422 });
    clearInterval(iv);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(tick).toBeGreaterThan(20);
  }, 30_000);
  it(`HTML do mammoth sinh ra > ${MAX_VIEW_HTML} byte -> 413`, async () => {
    const id = await mkDoc();
    const para = "a".repeat(10_000);
    const r = await up(id, [{ name: "huge.docx", data: await makeDocx(Array.from({ length: Math.ceil(MAX_VIEW_HTML / 10_000) + 20 }, () => para)) }]);
    expect(r.status).toBe(201);
    expect((await viewOf((await jsonOf(r)).files[0].id)).status).toBe(413);
  }, 60_000);
});

describe("F7: CSP do route tự đặt (một header duy nhất, có frame-ancestors 'self')", () => {
  const get = (id: string, query: Record<string, string> = {}) => call(serve, `/api/files/${id}`, { cookie: s.cookie, params: { id }, query });
  it("PDF: default-src 'none' + frame-ancestors 'self'; txt/docx: sandbox + frame-ancestors 'self'; cả khi ?download=1", async () => {
    const id = await mkDoc();
    const ids = [
      (await jsonOf(await up(id, [{ name: "a.pdf", data: Buffer.from(`%PDF-1.4\n% ${rnd()}\n%%EOF\n`) }]))).files[0].id,
      (await jsonOf(await up(id, [{ name: "a.txt", data: Buffer.from(`hi ${rnd()}`) }]))).files[0].id,
      (await jsonOf(await up(id, [{ name: "a.docx", data: await makeDocx([rnd()]) }]))).files[0].id,
    ] as string[];
    for (const q of [{} as Record<string, string>, { download: "1" }]) {
      const [pdfR, txtR, docxR] = await Promise.all(ids.map((i) => get(i, q)));
      expect(pdfR!.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
      expect(txtR!.headers.get("content-security-policy")).toBe("sandbox; frame-ancestors 'self'");
      expect(docxR!.headers.get("content-security-policy")).toBe("sandbox; frame-ancestors 'self'");
    }
  });
});

describe("L-g/L-e: schema khớp migration", () => {
  it("không còn index thừa; default absolute_expires_at là now()+60 ngày", async () => {
    const idx = (await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('file', 'login_attempt')`).map((r) => r.indexname);
    expect(idx).not.toContain("file_item_id_idx");
    expect(idx).not.toContain("login_attempt_username_created_at_idx");
    expect(idx).toContain("file_item_id_sha256_key");
    expect(idx).toContain("login_attempt_kind_username_created_at_idx");
    const [d] = await prisma.$queryRaw<{ def: string }[]>`SELECT pg_get_expr(adbin, adrelid) AS def FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = 'session'::regclass AND a.attname = 'absolute_expires_at'`;
    expect(d!.def).toMatch(/now\(\)\s*\+\s*'60 days'/);
  });
});
