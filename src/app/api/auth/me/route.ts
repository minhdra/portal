import { json, route } from "@/server/http";
import { toUserDto } from "@/server/services/auth";

export const dynamic = "force-dynamic";

export const GET = route("allowMustChange", async (c) => json({ user: toUserDto(c.user) }));
