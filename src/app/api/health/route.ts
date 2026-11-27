import { prisma } from "@/server/db";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route("none", async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return json({ ok: false }, { status: 503 });
  }
  return json({ ok: true });
});
