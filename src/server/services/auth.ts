import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../db";
import { SESSION_ABSOLUTE_TTL_MS, SESSION_TTL_MS, cookieSecurePinned, deviceSecret, sessionCookieName } from "../env";
import { ApiError } from "../errors";
import { Semaphore } from "../lib/semaphore";
import { newToken, sha256Hex, truncate } from "../lib/util";

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/**
 * Tối đa 2 phép băm argon2 chạy cùng lúc (mỗi phép ~19 MB, chiếm một luồng libuv); hàng đợi có trần.
 * libuv mặc định chỉ 4 luồng và dùng chung cho fs/dns/zlib: để dành chỗ cho đọc file (PDF/upload). Máy nhiều nhân
 * có thể đặt UV_THREADPOOL_SIZE=8 trong môi trường container (xem .env.example) rồi nâng cổng này nếu cần.
 */
const argonGate = new Semaphore(2, 100);

export const hashPassword = (pw: string): Promise<string> => argonGate.run(() => argon2.hash(pw, ARGON_OPTS));

let dummyHash: string | undefined;
let dummyPending: Promise<string> | undefined;
/**
 * Hash giả (cùng tham số) để thời gian xử lý không lộ user có tồn tại hay không. Tính qua argonGate như mọi phép băm
 * khác và KHÔNG cache lỗi (429 do hàng đợi đầy sẽ không làm hỏng mọi lần sau).
 */
const getDummyHash = (): Promise<string> => {
  if (dummyHash) return Promise.resolve(dummyHash);
  dummyPending ??= argonGate.run(() => argon2.hash(newToken(), ARGON_OPTS)).then(
    (h) => (dummyHash = h),
    (e) => {
      dummyPending = undefined;
      throw e;
    },
  );
  return dummyPending;
};

export async function verifyPassword(hash: string | null, pw: string): Promise<boolean> {
  const h = hash ?? (await getDummyHash());
  return argonGate.run(async () => {
    let ok = false;
    try {
      ok = await argon2.verify(h, pw);
    } catch {
      ok = false;
    }
    return hash !== null && ok;
  });
}

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS_PAIR = 5; // theo (kind, username, ip): khoá cứng trong cửa sổ
export const MAX_FAILS_IP = 30; // theo ip (mọi username, mọi kind): khoá cứng
// Theo username (mọi ip): KHÔNG khoá cứng. Sau USER_FREE_FAILS lần sai, mỗi lần thử kế tiếp phải cách lần sai
// trước >= min(BASE * 2^(n - FREE), CAP). Người đã từng đăng nhập từ chính IP đó được miễn bước này. Xem ADR 0002.
export const USER_FREE_FAILS = 10;
export const USER_BACKOFF_BASE_MS = 1000;
export const USER_BACKOFF_CAP_MS = 60_000;

export type AttemptKind = "login" | "cp";
const clip = (s: string) => truncate(s, 64); // CHECK login_attempt: <= 64 ký tự

const rateLimited = (retryAfterSec: number, msg: string) =>
  new ApiError("rate_limited", msg, { headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec))) } });

/**
 * Kiểm tra giới hạn VÀ đặt chỗ (ghi một hàng "sai" trước khi verify) trong cùng một giao dịch, tuần tự hoá bằng
 * pg_advisory_xact_lock theo (kind, username) và theo ip. Nhờ vậy N request song song không thể cùng lọt qua
 * ngưỡng: lần thứ 6 thấy 5 hàng đặt chỗ và bị từ chối. Đăng nhập đúng thì finishAttempt đổi hàng thành success.
 * Hàng đặt chỗ mồ côi (tiến trình chết giữa chừng) vẫn tính là lần sai: an toàn theo hướng chặn.
 */
export async function reserveAttempt(
  kind: AttemptKind,
  username: string,
  ip: string,
  opts: { knownDevice?: boolean } = {},
): Promise<bigint> {
  const u = clip(username);
  const i = clip(ip);
  // IP không xác định (TRUST_PROXY tắt/header hỏng): mọi người dùng chung một khoá. Khoá cứng theo IP/cặp khi đó là khoá
  // toàn cục (30 lần sai của bất kỳ ai khoá cả site), nên bỏ; chỉ còn backoff theo username và không miễn theo IP phiên.
  const unknownIp = i === "unknown";
  const locks = [`login:${kind}:u:${u}`, `login:ip:${i}`].sort(); // thứ tự cố định tránh deadlock
  return prisma.$transaction(
    async (tx) => {
      for (const k of locks) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${k}, 0))`;
      const since = new Date(Date.now() - WINDOW_MS);
      const [c] = await tx.$queryRaw<{ pair: bigint; by_ip: bigint; by_user: bigint; user_idle_ms: number | null }[]>`
        SELECT count(*) FILTER (WHERE kind = ${kind} AND username = ${u} AND ip = ${i}) AS pair,
               count(*) FILTER (WHERE ip = ${i}) AS by_ip,
               count(*) FILTER (WHERE kind = ${kind} AND username = ${u}) AS by_user,
               (extract(epoch FROM now() - max(created_at) FILTER (WHERE kind = ${kind} AND username = ${u})) * 1000)::float8 AS user_idle_ms
        FROM login_attempt
        WHERE success = false AND created_at > ${since} AND (ip = ${i} OR (kind = ${kind} AND username = ${u}))`;
      const pair = Number(c!.pair);
      const byIp = Number(c!.by_ip);
      const byUser = Number(c!.by_user);
      if (!unknownIp && (pair >= MAX_FAILS_PAIR || byIp >= MAX_FAILS_IP)) {
        throw rateLimited(WINDOW_MS / 1000, "Thử quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.");
      }
      if (byUser >= USER_FREE_FAILS) {
        const gap = Math.min(USER_BACKOFF_BASE_MS * 2 ** Math.min(byUser - USER_FREE_FAILS, 20), USER_BACKOFF_CAP_MS);
        const wait = gap - (c!.user_idle_ms ?? Infinity);
        if (wait > 0 && !opts.knownDevice) {
          const known = unknownIp ? null : await tx.session.findFirst({ where: { ip: i, user: { username: u } }, select: { id: true } });
          if (!known) throw rateLimited(wait / 1000, "Tài khoản này đang bị thử nhiều lần. Vui lòng đợi ít giây rồi thử lại.");
        }
      }
      return (await tx.loginAttempt.create({ data: { kind, username: u, ip: i, success: false }, select: { id: true } })).id;
    },
    { maxWait: 15_000, timeout: 15_000 },
  );
}

/**
 * Lượt verify bị từ chối vì máy chủ bận (429 của argonGate) chưa hề thử mật khẩu nào: trả lại chỗ đã đặt để
 * không bị tính là lần sai (kẻ gây nghẽn không nên khoá nạn nhân; người dùng thật không bị phạt oan).
 */
export async function releaseAttempt(id: bigint): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { id, success: false } });
}

/** Chạy verifyPassword; nếu bị argonGate từ chối (429) thì xoá hàng đặt chỗ rồi ném lại. */
export async function verifyReserved(attemptId: bigint, hash: string | null, pw: string): Promise<boolean> {
  try {
    return await verifyPassword(hash, pw);
  } catch (e) {
    if (e instanceof ApiError && e.code === "rate_limited") await releaseAttempt(attemptId);
    throw e;
  }
}

/**
 * Đăng nhập/đổi mật khẩu đúng: xoá mọi lần sai (kể cả hàng đặt chỗ của chính nó) của cặp rồi ghi một hàng success.
 * Không UPDATE theo id: hai lần đúng song song có thể xoá hàng đặt chỗ của nhau.
 */
export async function finishAttempt(kind: AttemptKind, username: string, ip: string): Promise<void> {
  const u = clip(username);
  const i = clip(ip);
  await prisma.$transaction([
    prisma.loginAttempt.deleteMany({ where: { kind, username: u, ip: i, success: false } }),
    prisma.loginAttempt.create({ data: { kind, username: u, ip: i, success: true } }),
  ]);
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
      absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_TTL_MS),
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
  const token = readCookie(req.headers.get("cookie"), sessionCookieName());
  if (!token || token.length < 20 || token.length > 100) return null;
  const tokenHash = sha256Hex(token);
  const s = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() <= now || s.absoluteExpiresAt.getTime() <= now || !s.user.isActive) return null;
  if (now - s.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    // Gia hạn trượt, nhưng không bao giờ vượt hạn tuyệt đối.
    const slid = Math.min(now + SESSION_TTL_MS, s.absoluteExpiresAt.getTime());
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(now), expiresAt: new Date(slid) } });
  }
  const u = s.user;
  return {
    sessionId: s.id,
    user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role, mustChangePassword: u.mustChangePassword },
  };
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${sessionCookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

// ---------- Cookie "thiết bị quen" (ADR 0002, F3) ----------
// Sau đăng nhập đúng, đặt cookie HttpOnly gồm username + 16 byte ngẫu nhiên + HMAC-SHA256(SESSION_SECRET). Thiết bị có
// cookie hợp lệ của đúng username được MIỄN backoff theo username (không miễn khoá cứng theo cặp/IP). Nhờ vậy chủ tài
// khoản ở IP mới (đổi mạng, di động, IPv6 xoay) vẫn đăng nhập được lúc kẻ lạ đang dò. Cookie không phải thông tin xác
// thực: lộ nó chỉ bỏ được bước làm chậm, vẫn bị khoá cứng 5 lần/15 phút. Logout KHÔNG xoá cookie này (thiết bị vẫn quen).
const DEVICE_MAX_AGE_S = 180 * 24 * 60 * 60;
export const deviceCookieName = (): string => (cookieSecurePinned() ? "__Host-portal_device" : "portal_device");
const deviceSig = (secret: string, payload: string): string => createHmac("sha256", secret).update(`device:v1:${payload}`).digest("base64url");

export function deviceCookie(username: string, secure: boolean): string | null {
  const secret = deviceSecret();
  if (!secret) return null;
  const payload = `${Buffer.from(username).toString("base64url")}.${randomBytes(16).toString("base64url")}`;
  return [`${deviceCookieName()}=${payload}.${deviceSig(secret, payload)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${DEVICE_MAX_AGE_S}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function isKnownDevice(cookieHeader: string | null, username: string): boolean {
  const secret = deviceSecret();
  const v = readCookie(cookieHeader, deviceCookieName());
  if (!secret || !v) return false;
  const parts = v.split(".");
  if (parts.length !== 3 || parts[0] !== Buffer.from(username).toString("base64url")) return false;
  const want = Buffer.from(deviceSig(secret, `${parts[0]}.${parts[1]}`));
  const got = Buffer.from(parts[2]!);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const clearCookie = (secure: boolean): string =>
  `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

export async function cleanupExpired(): Promise<{ sessions: number; attempts: number }> {
  const sessions = await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { absoluteExpiresAt: { lt: new Date() } }] } });
  const attempts = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return { sessions: sessions.count, attempts: attempts.count };
}
