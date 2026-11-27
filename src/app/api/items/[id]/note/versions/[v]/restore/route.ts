import { notFound } from "@/server/errors";
import { json, route } from "@/server/http";
import { restoreVersion } from "@/server/services/notes";

export const dynamic = "force-dynamic";

export const POST = route("required", async (c) => {
  const v = Number(c.params.v);
  if (!Number.isInteger(v) || v < 1 || v > 2_000_000_000) throw notFound("Không có phiên bản này.");
  return json(await restoreVersion(c.params.id!, v, c.user.id, c.ip));
});
