import { json, noContent, route } from "@/server/http";
import { clearIcon, readIconBody, serveIcon, setIcon } from "@/server/services/icons";
import { getItem } from "@/server/services/items";

export const dynamic = "force-dynamic";

export const GET = route("required", (c) => serveIcon(c.req, "item", c.params.id!));

/** Thân: ảnh thô (png/jpeg/webp/gif, <= 64 KB) hoặc multipart trường `file`. Kiểm bằng magic bytes. */
export const PUT = route("required", async (c) => {
  await setIcon("item", c.params.id!, await readIconBody(c.req), c.user.id, c.ip);
  return json(await getItem(c.params.id!));
});

export const DELETE = route("required", async (c) => {
  await clearIcon("item", c.params.id!, c.user.id, c.ip);
  return noContent();
});
