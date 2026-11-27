import { z } from "zod";
import { prisma } from "@/server/db";
import { ApiError, invalid } from "@/server/errors";
import { isSecureRequest, json, route } from "@/server/http";
import { audit } from "@/server/services/audit";
import {
  createSession, deviceCookie, finishAttempt, isKnownDevice, reserveAttempt, sessionCookie, toUserDto, verifyReserved,
} from "@/server/services/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ username: z.string().max(200), password: z.string().min(1).max(256) });

export const POST = route("none", async (c) => {
  const b = await c.body(Body, 4096);
  const username = b.username.trim().toLowerCase();
  if (!username) throw invalid("Thiếu tên đăng nhập.", { username: "Bắt buộc" });

  // Đặt chỗ lần thử TRƯỚC khi verify: nếu verify thất bại/ngắt giữa chừng thì lần thử vẫn được tính.
  const attemptId = await reserveAttempt("login", username, c.ip, { knownDevice: isKnownDevice(c.req.headers.get("cookie"), username) });

  const user = await prisma.user.findUnique({ where: { username } });
  const active = user && user.isActive ? user : null;
  // Luôn chạy argon2.verify (hash giả khi không có user) để thời gian không lộ user tồn tại.
  const ok = await verifyReserved(attemptId, active?.passwordHash ?? null, b.password);

  if (!active || !ok) {
    await audit(active?.id ?? null, "auth.login_failed", "user", active?.id ?? null, { username: username.slice(0, 64) }, c.ip);
    throw new ApiError("unauthenticated", "Tên đăng nhập hoặc mật khẩu không đúng.");
  }

  await finishAttempt("login", username, c.ip);
  const s = await createSession(active.id, c.ip, c.req.headers.get("user-agent"));
  await audit(active.id, "auth.login", "user", active.id, null, c.ip);
  const secure = isSecureRequest(c.req);
  const headers = new Headers({ "Set-Cookie": sessionCookie(s.token, s.maxAgeSeconds, secure) });
  const device = deviceCookie(username, secure);
  if (device) headers.append("Set-Cookie", device);
  return json({ user: toUserDto(active) }, { headers });
});
