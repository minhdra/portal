import { noContent, route } from "@/server/http";
import { deleteFile, serveFile } from "@/server/services/files";

export const dynamic = "force-dynamic";

export const GET = route("required", async (c) =>
  serveFile(c.req, c.params.id!, ["1", "true"].includes(c.url.searchParams.get("download") ?? "")),
);

export const DELETE = route("required", async (c) => {
  await deleteFile(c.params.id!, c.user.id, c.ip);
  return noContent();
});
