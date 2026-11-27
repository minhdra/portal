import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * CSP toàn app (docs/adr/0003-security-hardening.md).
 * script-src 'unsafe-inline': Next nhúng script hydrate nội tuyến (self.__next_f.push) và layout có THEME_SCRIPT
 *   chống nháy giao diện. Dùng nonce buộc mọi trang render động qua proxy; chấp nhận 'unsafe-inline' ở mức tối thiểu
 *   vì nội dung người dùng (markdown/docx) đã bị lọc HTML ở server và client, 'self' + object-src 'none' + base-uri
 *   chặn script/plugin ngoài. Dev cần 'unsafe-eval' (React refresh); production thì không.
 * style-src 'unsafe-inline': React style={...} và Next chèn <style>; không thực thi được mã.
 * img-src data:: ảnh docx nhúng data: URI (đã lọc png/jpeg/gif).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // mammoth/read-excel-file được nạp trong worker_threads bằng require từ node_modules: không đóng gói vào bundle.
  serverExternalPackages: ["mammoth", "read-excel-file"],
  async headers() {
    return [
      // Mọi đường dẫn trừ /api/files/*: CSP đầy đủ, không cho nhúng khung.
      {
        source: "/((?!api/files/).*)",
        headers: [
          ...common,
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // /api/files/*: route tự đặt CSP riêng (sandbox / default-src 'none' cho PDF) và giữ nguyên;
      // ở đây chỉ thêm frame-ancestors 'self' để trang portal nhúng được PDF trong iframe cùng origin.
      {
        source: "/api/files/:path*",
        headers: [
          ...common,
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};
export default config;
