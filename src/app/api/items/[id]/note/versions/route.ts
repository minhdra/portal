import { json, route } from "@/server/http";
import { listVersions } from "@/server/services/notes";

export const dynamic = "force-dynamic";

export const GET = route("required", async (c) => json(await listVersions(c.params.id!)));
