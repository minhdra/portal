import { json, route } from "@/server/http";
import { viewFile } from "@/server/services/view";

export const dynamic = "force-dynamic";

export const GET = route("required", async (c) => json(await viewFile(c.params.id!)));
