import { z } from "zod";
import { json, parseQuery, route } from "@/server/http";
import { search } from "@/server/services/items";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().trim().max(200).default("") });

export const GET = route("required", async (c) => json(await search(parseQuery(c.url, Query).q)));
