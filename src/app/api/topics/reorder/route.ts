import { z } from "zod";
import { noContent, route } from "@/server/http";
import { uuid } from "@/server/schemas";
import { reorderTopics } from "@/server/services/topics";

export const dynamic = "force-dynamic";

const Body = z.object({ parentId: uuid.nullable(), ids: z.array(uuid).max(500) });

export const POST = route("required", async (c) => {
  const b = await c.body(Body);
  await reorderTopics(b.parentId, b.ids, c.user.id, c.ip);
  return noContent();
});
