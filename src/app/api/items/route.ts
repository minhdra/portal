import { z } from "zod";
import { json, parseQuery, route } from "@/server/http";
import { itemType, optText, shortText, uuid, urlField, itemStatus } from "@/server/schemas";
import { createItem, listItems } from "@/server/services/items";

export const dynamic = "force-dynamic";

const flag = z.enum(["1", "0", "true", "false"]).transform((v) => v === "1" || v === "true");

const Query = z.object({
  topic: z.union([uuid, z.literal("none")]).optional(),
  q: z.string().max(200).optional(),
  tag: z.string().max(80).optional(),
  type: itemType.optional(),
  status: z.union([itemStatus, z.literal("all")]).optional(),
  pinned: flag.optional(),
  recent: flag.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

const Create = z.object({
  type: itemType,
  title: shortText(200, "Tiêu đề"),
  description: optText(5000).nullish(),
  url: urlField.nullish(),
  icon: optText(60).nullish(),
  topicId: uuid.nullish(),
  tags: z.array(shortText(40, "Nhãn")).max(20).optional(),
});

export const GET = route("required", async (c) => json(await listItems(parseQuery(c.url, Query))));

export const POST = route("required", async (c) => {
  const b = await c.body(Create);
  return json(await createItem(b, c.user.id, c.ip), { status: 201 });
});
