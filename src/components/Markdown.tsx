"use client";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { fileUrl } from "@/lib/api-client";
import { safeDecode } from "@/lib/safe-decode";

// Bộ lọc mặc định của rehype-sanitize: bỏ script, on*, javascript:, style.
const remark = [remarkGfm];
const rehype = [rehypeSanitize];

const components: Components = {
  a: ({ href, children }) => {
    const external = !!href && /^https?:/i.test(href);
    return <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>;
  },
  img: ({ src, alt }) => {
    const s = typeof src === "string" ? src : "";
    const m = s.match(/^\/api\/files\/([^/?#]+)/);
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m ? fileUrl(safeDecode(m[1])) : s} alt={alt ?? ""} loading="lazy" />;
  },
};

export const Markdown = memo(function Markdown({ source }: { source: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remark} rehypePlugins={rehype} components={components}>{source}</ReactMarkdown>
    </div>
  );
});
