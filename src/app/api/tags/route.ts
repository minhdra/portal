import { json, route } from "@/server/http";
import { listTags } from "@/server/services/items";

export const dynamic = "force-dynamic";

export const GET = route("required", async () => json({ tags: await listTags() }));
