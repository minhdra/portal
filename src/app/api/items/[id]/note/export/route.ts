import { invalid } from "@/server/errors";
import { route } from "@/server/http";
import { slugify } from "@/server/lib/util";
import { exportNote } from "@/server/services/notes";

export const dynamic = "force-dynamic";

export const GET = route("required", async (c) => {
  const format = c.url.searchParams.get("format") ?? "md";
  if (format !== "md") throw invalid("Chỉ hỗ trợ format=md.", { format: "Chỉ hỗ trợ md" });
  const n = await exportNote(c.params.id!, c.user.id);
  const base = slugify(n.title) || "ghi-chu";
  return new Response(n.markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.md"; filename*=UTF-8''${encodeURIComponent(n.title.slice(0, 100))}.md`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "no-store",
    },
  });
});
