import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { sha256Hex } from "@/server/lib/util";
import { cleanupExpired } from "@/server/services/auth";
import { GET as health } from "@/app/api/health/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as changePw } from "@/app/api/auth/change-password/route";
import { GET as topicsGet } from "@/app/api/topics/route";
import { call, freshIp, jsonOf, loginCookie, makeUser, rnd } from "./helpers";

beforeAll(() => {
  expect(process.env.DATABASE_URL).toBeTruthy();
});

describe("health", () => {
  it("không cần đăng nhập", async () => {
    const r = await call(health, "/api/health");
    expect(r.status).toBe(200);
    expect(await jsonOf(r)).toEqual({ ok: true });
  });
});

describe("login / logout / me", () => {
  it("đăng nhập đúng: cookie httpOnly+Lax, DB chỉ lưu sha256", async () => {
    const u = await makeUser();
    const r = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username.toUpperCase(), password: u.password } });
    expect(r.status).toBe(200);
    const b = await jsonOf(r);
    expect(b.user).toMatchObject({ username: u.username, role: "admin", mustChangePassword: false });
    expect(b.user.passwordHash).toBeUndefined();
    const sc = r.headers.get("set-cookie")!;
    expect(sc).toMatch(/^portal_session=/);
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).not.toMatch(/Secure/); // http
    const token = sc.split(";")[0]!.split("=")[1]!;
    expect(Buffer.from(token, "base64url").length).toBe(32);
    const rows = await prisma.session.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(sha256Hex(token));
    expect(rows[0]!.tokenHash).not.toContain(token);
  });

  it("Secure khi https qua proxy", async () => {
    const u = await makeUser();
    const r = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password }, headers: { "x-forwarded-proto": "https" } });
    expect(r.headers.get("set-cookie")).toMatch(/Secure/);
  });

  it("sai mật khẩu và user không tồn tại cho cùng một phản hồi chung chung", async () => {
    const u = await makeUser();
    const a = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: "sai-sai-sai-sai" }, ip: freshIp() });
    const b = await call(login, "/api/auth/login", { method: "POST", body: { username: `khong-co-${rnd()}`, password: "sai-sai-sai-sai" }, ip: freshIp() });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await jsonOf(a)).toEqual(await jsonOf(b));
  });

  it("user không tồn tại vẫn tốn thời gian băm (hash giả)", async () => {
    const t0 = performance.now();
    await call(login, "/api/auth/login", { method: "POST", body: { username: `khong-co-${rnd()}`, password: "x".repeat(12) }, ip: freshIp() });
    expect(performance.now() - t0).toBeGreaterThan(5);
  });

  it("rate limit: 5 lần sai -> 429, kể cả khi sau đó nhập đúng; IP khác vẫn đăng nhập được", async () => {
    const u = await makeUser();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const r = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: "sai-sai-sai-sai" }, ip });
      expect(r.status).toBe(401);
    }
    const blocked = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password }, ip });
    expect(blocked.status).toBe(429);
    expect((await jsonOf(blocked)).error.code).toBe("rate_limited");
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const other = await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password }, ip: freshIp() });
    expect(other.status).toBe(200);
  });

  it("cắt username/ip về 64 ký tự khi ghi login_attempt (không 500)", async () => {
    const longName = "a".repeat(150);
    const r = await call(login, "/api/auth/login", { method: "POST", body: { username: longName, password: "x".repeat(12) }, ip: "9.9.9.9," + "1".repeat(200) });
    expect(r.status).toBe(401);
    const row = await prisma.loginAttempt.findFirst({ where: { username: "a".repeat(64) }, orderBy: { id: "desc" } });
    expect(row).toBeTruthy();
    expect(row!.username.length).toBe(64);
    expect(row!.ip.length).toBeLessThanOrEqual(64);
  });

  it("body sai: JSON hỏng/thiếu trường -> 422 validation", async () => {
    const r1 = await call(login, "/api/auth/login", { method: "POST", body: "{not json" });
    expect(r1.status).toBe(422);
    const r2 = await call(login, "/api/auth/login", { method: "POST", body: { username: "a" } });
    expect(r2.status).toBe(422);
    expect((await jsonOf(r2)).error.code).toBe("validation");
  });

  it("me / logout", async () => {
    const u = await makeUser();
    const cookie = await loginCookie(u.username, u.password);
    const m = await call(me, "/api/auth/me", { cookie });
    expect(m.status).toBe(200);
    expect((await jsonOf(m)).user.username).toBe(u.username);
    const lo = await call(logout, "/api/auth/logout", { method: "POST", cookie });
    expect(lo.status).toBe(204);
    expect(lo.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await call(me, "/api/auth/me", { cookie })).status).toBe(401);
  });

  it("chưa đăng nhập -> 401 unauthenticated; cookie rác -> 401", async () => {
    const r = await call(topicsGet, "/api/topics");
    expect(r.status).toBe(401);
    expect((await jsonOf(r)).error.code).toBe("unauthenticated");
    expect((await call(topicsGet, "/api/topics", { cookie: "portal_session=abcdefghijklmnopqrstuvwxyz0123" })).status).toBe(401);
  });

  it("user bị khoá (is_active=false) mất phiên", async () => {
    const u = await makeUser();
    const cookie = await loginCookie(u.username, u.password);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await call(me, "/api/auth/me", { cookie })).status).toBe(401);
  });

  it("job dọn: session hết hạn và login_attempt cũ bị xoá", async () => {
    const u = await makeUser();
    await prisma.session.create({ data: { userId: u.id, tokenHash: sha256Hex(rnd(16)), expiresAt: new Date(Date.now() - 1000) } });
    const keep = await prisma.session.create({ data: { userId: u.id, tokenHash: sha256Hex(rnd(16)), expiresAt: new Date(Date.now() + 100000) } });
    const old = await prisma.loginAttempt.create({ data: { username: "cleanup-old", ip: "1.1.1.1", success: false, createdAt: new Date(Date.now() - 3 * 86400_000) } });
    const res = await cleanupExpired();
    expect(res.sessions).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: keep.id } })).toBeTruthy();
    expect(await prisma.loginAttempt.findUnique({ where: { id: old.id } })).toBeNull();
  });
});

describe("đổi mật khẩu bắt buộc", () => {
  it("must_change_password chặn mọi route trừ me/change-password/logout; đổi xong xoá session khác", async () => {
    const u = await makeUser({ mustChange: true });
    const a = await loginCookie(u.username, u.password);
    const b = await loginCookie(u.username, u.password);

    const blocked = await call(topicsGet, "/api/topics", { cookie: a });
    expect(blocked.status).toBe(403);
    expect((await jsonOf(blocked)).error.code).toBe("must_change_password");
    const m = await call(me, "/api/auth/me", { cookie: a });
    expect((await jsonOf(m)).user.mustChangePassword).toBe(true);

    const short = await call(changePw, "/api/auth/change-password", { method: "POST", cookie: a, body: { currentPassword: u.password, newPassword: "ngan" } });
    expect(short.status).toBe(422);
    const wrong = await call(changePw, "/api/auth/change-password", { method: "POST", cookie: a, body: { currentPassword: "sai-sai-sai-sai", newPassword: "mat-khau-moi-dai" } });
    expect(wrong.status).toBe(422);
    const same = await call(changePw, "/api/auth/change-password", { method: "POST", cookie: a, body: { currentPassword: u.password, newPassword: u.password + "" } });
    expect(same.status).toBe(422);

    const newPassword = `moi-${rnd(10)}`;
    const ok = await call(changePw, "/api/auth/change-password", { method: "POST", cookie: a, body: { currentPassword: u.password, newPassword } });
    expect(ok.status).toBe(204);

    expect((await call(me, "/api/auth/me", { cookie: b })).status).toBe(401); // session khác bị xoá
    expect((await call(topicsGet, "/api/topics", { cookie: a })).status).toBe(200); // session hiện tại còn
    expect((await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: u.password }, ip: freshIp() })).status).toBe(401);
    expect((await call(login, "/api/auth/login", { method: "POST", body: { username: u.username, password: newPassword }, ip: freshIp() })).status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: u.id } });
    expect(row!.passwordHash.startsWith("$argon2id$")).toBe(true);
  });
});

describe("CSRF (Origin)", () => {
  it("ghi mà Origin khác host -> 403; thiếu Origin -> 403; GET không cần Origin", async () => {
    const u = await makeUser();
    const cookie = await loginCookie(u.username, u.password);
    const evil = await call(logout, "/api/auth/logout", { method: "POST", cookie, origin: "http://evil.example" });
    expect(evil.status).toBe(403);
    const none = await call(logout, "/api/auth/logout", { method: "POST", cookie, origin: null });
    expect(none.status).toBe(403);
    const bad = await call(logout, "/api/auth/logout", { method: "POST", cookie, origin: "not a url" });
    expect(bad.status).toBe(403);
    // login cũng bị kiểm tra
    const l = await call(login, "/api/auth/login", { method: "POST", origin: "http://evil.example", body: { username: u.username, password: u.password } });
    expect(l.status).toBe(403);
    expect((await call(me, "/api/auth/me", { cookie })).status).toBe(200);
    expect((await call(logout, "/api/auth/logout", { method: "POST", cookie })).status).toBe(204);
  });

  it("tin X-Forwarded-Host khi đi sau gateway", async () => {
    const u = await makeUser();
    const r = await call(login, "/api/auth/login", {
      method: "POST", origin: "https://xldl.example", headers: { host: "portal:3100", "x-forwarded-host": "xldl.example" },
      body: { username: u.username, password: u.password },
    });
    expect(r.status).toBe(200);
  });
});
