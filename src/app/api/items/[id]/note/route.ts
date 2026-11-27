import { z } from "zod";
import { json, route } from "@/server/http";
import { MAX_NOTE_CHARS, getNote, putNote } from "@/server/services/notes";

export const dynamic = "force-dynamic";

const Put = z.object({
  markdown: z.string().max(MAX_NOTE_CHARS, "Ghi chú quá dài"),
  baseVersion: z.number().int().min(1),
});

export const GET = route("required", async (c) => json(await getNote(c.params.id!, c.user.id)));

export const PUT = route("required", async (c) => {
  const b = await c.body(Put, 4 * 1024 * 1024);
  return json(await putNote(c.params.id!, b.markdown, b.baseVersion, c.user.id, c.ip));
});
