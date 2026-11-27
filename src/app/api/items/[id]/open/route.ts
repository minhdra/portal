import { noContent, route } from "@/server/http";
import { markOpened } from "@/server/services/items";

export const dynamic = "force-dynamic";

export const POST = route("required", async (c) => {
  await markOpened(c.params.id!);
  return noContent();
});
