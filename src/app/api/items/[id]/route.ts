import { z } from "zod";
import { json, noContent, route } from "@/server/http";
import { itemStatus, itemType, optText, shortText, uuid, urlField } from "@/server/schemas";
import { archiveItem, getItem, hardDeleteItem, updateItem } from "@/server/services/items";

export const dynamic = "force-dynamic";

const Patch = z.object({
  type: itemType.optional(),
  title: shortText(200, "Tiêu đề").optional(),
  description: optText(5000).nullable().optional(),
  url: urlField.nullable().optional(),
  icon: optText(60).nullable().optional(),
  topicId: uuid.nullable().optional(),
  tags: z.array(shortText(40, "Nhãn")).max(20).optional(),
  status: itemStatus.optional(),
  pinned: z.boolean().optional(),
});

export const GET = route("required", async (c) => json(await getItem(c.params.id!)));

export const PATCH = route("required", async (c) => {
  const b = await c.body(Patch);
  return json(await updateItem(c.params.id!, b, c.user.id, c.ip));
});

export const DELETE = route("required", async (c) => {
  const hard = ["1", "true"].includes(c.url.searchParams.get("hard") ?? "");
  if (hard) await hardDeleteItem(c.params.id!, c.user.id, c.ip);
  else await archiveItem(c.params.id!, c.user.id, c.ip);
  return noContent();
});
