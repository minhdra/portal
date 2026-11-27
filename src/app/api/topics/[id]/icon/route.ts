import { json, noContent, route } from "@/server/http";
import { clearIcon, readIconBody, serveIcon, setIcon } from "@/server/services/icons";
import { getTopic } from "@/server/services/topics";

export const dynamic = "force-dynamic";

export const GET = route("required", (c) => serveIcon(c.req, "topic", c.params.id!));

/** Thân: ảnh thô (png/jpeg/webp/gif, <= 64 KB) hoặc multipart trường `file`. Kiểm bằng magic bytes. */
export const PUT = route("required", async (c) => {
  await setIcon("topic", c.params.id!, await readIconBody(c.req), c.user.id, c.ip);
  return json(await getTopic(c.params.id!));
});

export const DELETE = route("required", async (c) => {
  await clearIcon("topic", c.params.id!, c.user.id, c.ip);
  return noContent();
});
