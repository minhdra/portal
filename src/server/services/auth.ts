import argon2 from "argon2";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../db";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../env";
import { ApiError } from "../errors";
import { newToken, sha256Hex, truncate } from "../lib/util";

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, ARGON_OPTS);

let dummyHash: Promise<string> | undefined;
/** Hash giả (cùng tham số) để thời gian xử lý không lộ user có tồn tại hay không. */
const getDummyHash = () => (dummyHash ??= argon2.hash(newToken(), ARGON_OPTS));

export async function verifyPassword(hash: string | null, pw: string): Promise<boolean> {
  const h = hash ?? (await getDummyHash());
  let ok = false;
  try {
    ok = await argon2.verify(h, pw);
  } catch {
    ok = false;
  }
  return hash !== null && ok;
}

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS_PAIR = 5; // theo (username, ip)
export const MAX_FAILS_IP = 30; // theo ip (mọi username)
export const MAX_FAILS_USER = 30; // theo username (mọi ip), chặn dò phân tán

const clip = (s: string) => truncate(s, 64); // CHECK login_attempt: <= 64 ký tự

export async function assertNotRateLimited(username: string, ip: string): Promise<void> {
  const u = clip(username);
  const i = clip(ip);
  const since = new Date(Date.now() - WINDOW_MS);
  const [pair, byIp, byUser] = await Promise.all([
    prisma.loginAttempt.count({ where: { username: u, ip: i, success: false, createdAt: { gt: since } } }),
    prisma.loginAttempt.count({ where: { ip: i, success: false, createdAt: { gt: since } } }),
    prisma.loginAttempt.count({ where: { username: u, success: false, createdAt: { gt: since } } }),
  ]);
  if (pair >= MAX_FAILS_PAIR || byIp >= MAX_FAILS_IP || byUser >= MAX_FAILS_USER) {
    throw new ApiError("rate_limited", "Thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.", {
      headers: { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) },
    });
  }
}

export async function recordAttempt(username: string, ip: string, success: boolean): Promise<void> {
  const u = clip(username);
  const i = clip(ip);
  await prisma.loginAttempt.create({ data: { username: u, ip: i, success } });
  if (success) {
    // Đăng nhập đúng: xoá các lần sai của cặp này để không cộng dồn.
    await prisma.loginAttempt.deleteMany({ where: { username: u, ip: i, success: false } });
  }
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  mustChangePassword: boolean;
}

export const toUserDto = (u: SessionUser) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
});

export async function createSession(userId: string, ip: string, userAgent: string | null) {
  const token = newToken(); // 32 byte ngẫu nhiên
  const now = Date.now();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token), // DB chỉ lưu sha256
      expiresAt: new Date(now + SESSION_TTL_MS),
      ip: truncate(ip, 64),
      userAgent: userAgent ? truncate(userAgent, 300) : null,
    },
  });
  return { token, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) };
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const TOUCH_AFTER_MS = 5 * 60 * 1000;

export async function loadSession(req: Request): Promise<{ user: SessionUser; sessionId: string } | null> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token || token.length < 20 || token.length > 100) return null;
  const tokenHash = sha256Hex(token);
  const s = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!s) return null;
  // so sánh hằng thời gian trên hash (phòng hờ; tra cứu theo unique index đã ẩn token thô)
  const a = Buffer.from(s.tokenHash);
  const b = Buffer.from(tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() <= now || !s.user.isActive) return null;
  if (now - s.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await prisma.session.update({
      where: { id: s.id },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
    });
  }
  const u = s.user;
  return {
    sessionId: s.id,
    user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role, mustChangePassword: u.mustChangePassword },
  };
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export const clearCookie = (secure: boolean): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

export async function cleanupExpired(): Promise<{ sessions: number; attempts: number }> {
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const attempts = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return { sessions: sessions.count, attempts: attempts.count };
}
