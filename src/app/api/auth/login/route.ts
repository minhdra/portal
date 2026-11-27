import { z } from "zod";
import { prisma } from "@/server/db";
import { ApiError, invalid } from "@/server/errors";
import { isSecureRequest, json, route } from "@/server/http";
import { audit } from "@/server/services/audit";
import {
  assertNotRateLimited, createSession, recordAttempt, sessionCookie, toUserDto, verifyPassword,
} from "@/server/services/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ username: z.string().max(200), password: z.string().min(1).max(256) });

export const POST = route("none", async (c) => {
  const b = await c.body(Body, 4096);
  const username = b.username.trim().toLowerCase();
  if (!username) throw invalid("Thiếu tên đăng nhập.", { username: "Bắt buộc" });

  await assertNotRateLimited(username, c.ip);

  const user = await prisma.user.findUnique({ where: { username } });
  const active = user && user.isActive ? user : null;
  // Luôn chạy argon2.verify (hash giả khi không có user) để thời gian không lộ user tồn tại.
  const ok = await verifyPassword(active?.passwordHash ?? null, b.password);

  if (!active || !ok) {
    await recordAttempt(username, c.ip, false);
    await audit(active?.id ?? null, "auth.login_failed", "user", active?.id ?? null, { username: username.slice(0, 64) }, c.ip);
    throw new ApiError("unauthenticated", "Tên đăng nhập hoặc mật khẩu không đúng.");
  }

  await recordAttempt(username, c.ip, true);
  const s = await createSession(active.id, c.ip, c.req.headers.get("user-agent"));
  await audit(active.id, "auth.login", "user", active.id, null, c.ip);
  return json(
    { user: toUserDto(active) },
    { headers: { "Set-Cookie": sessionCookie(s.token, s.maxAgeSeconds, isSecureRequest(c.req)) } },
  );
});
