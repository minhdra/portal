import { prisma } from "@/server/db";
import { isSecureRequest, noContent, route } from "@/server/http";
import { audit } from "@/server/services/audit";
import { clearCookie } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const POST = route("allowMustChange", async (c) => {
  await prisma.session.deleteMany({ where: { id: c.sessionId } });
  await audit(c.user.id, "auth.logout", "user", c.user.id, null, c.ip);
  return noContent({ "Set-Cookie": clearCookie(isSecureRequest(c.req)) });
});
