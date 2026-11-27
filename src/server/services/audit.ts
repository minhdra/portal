import type { Db } from "../db";
import { prisma } from "../db";
import { truncate } from "../lib/util";

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string | null,
  entityId: string | null,
  metadata: Record<string, unknown> | null,
  ip: string | null,
  db: Db = prisma,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      metadata: (metadata ?? undefined) as never,
      ip: ip ? truncate(ip, 64) : null,
    },
  });
}
