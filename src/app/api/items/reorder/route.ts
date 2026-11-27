import { z } from "zod";
import { noContent, route } from "@/server/http";
import { uuid } from "@/server/schemas";
import { reorderItems } from "@/server/services/items";

export const dynamic = "force-dynamic";

const Body = z.object({ topicId: uuid.nullable(), ids: z.array(uuid).max(1000) });

export const POST = route("required", async (c) => {
  const b = await c.body(Body, 128 * 1024);
  await reorderItems(b.topicId, b.ids, c.user.id, c.ip);
  return noContent();
});
