import { z } from "zod";
import { prisma } from "@/server/db";
import { ApiError, invalid } from "@/server/errors";
import { noContent, route } from "@/server/http";
import { audit } from "@/server/services/audit";
import { assertNotRateLimited, hashPassword, recordAttempt, verifyPassword } from "@/server/services/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(10, "Mật khẩu mới tối thiểu 10 ký tự").max(256, "Mật khẩu mới tối đa 256 ký tự"),
});

export const POST = route("allowMustChange", async (c) => {
  const b = await c.body(Body, 4096);
  // Chống dò mật khẩu hiện tại bằng phiên bị đánh cắp: dùng chung bộ đếm với login (khoá riêng "cp:").
  const key = `cp:${c.user.username}`;
  await assertNotRateLimited(key, c.ip);

  const row = await prisma.user.findUnique({ where: { id: c.user.id } });
  const ok = await verifyPassword(row?.passwordHash ?? null, b.currentPassword);
  if (!row || !ok) {
    await recordAttempt(key, c.ip, false);
    throw new ApiError("validation", "Mật khẩu hiện tại không đúng.", { fields: { currentPassword: "Không đúng" } });
  }
  if (b.newPassword === b.currentPassword) {
    throw invalid("Mật khẩu mới phải khác mật khẩu hiện tại.", { newPassword: "Phải khác mật khẩu hiện tại" });
  }
  await recordAttempt(key, c.ip, true);
  const passwordHash = await hashPassword(b.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: row.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: row.id, id: { not: c.sessionId } } });
    await audit(row.id, "auth.change_password", "user", row.id, null, c.ip, tx);
  });
  return noContent();
});
