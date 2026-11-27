import { z } from "zod";
import { json, noContent, route } from "@/server/http";
import { optText, shortText, uuid } from "@/server/schemas";
import { deleteTopic, updateTopic } from "@/server/services/topics";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: shortText(100, "Tên").optional(),
  icon: optText(40).nullable().optional(),
  parentId: uuid.nullable().optional(),
});

export const PATCH = route("required", async (c) => {
  const b = await c.body(Patch);
  return json(await updateTopic(c.params.id!, b, c.user.id, c.ip));
});

export const DELETE = route("required", async (c) => {
  await deleteTopic(c.params.id!, c.user.id, c.ip);
  return noContent();
});
