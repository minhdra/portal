import { z } from "zod";
import { json, route } from "@/server/http";
import { optText, shortText, uuid } from "@/server/schemas";
import { createTopic, listTopics } from "@/server/services/topics";

export const dynamic = "force-dynamic";

const Create = z.object({
  parentId: uuid.nullish(),
  name: shortText(100, "Tên"),
  icon: optText(40).nullish(),
});

export const GET = route("required", async () => json({ topics: await listTopics() }));

export const POST = route("required", async (c) => {
  const b = await c.body(Create);
  return json(await createTopic(b, c.user.id, c.ip), { status: 201 });
});
