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
  // mammoth/read-excel-file/sanitize-html được nạp trong worker_threads bằng require từ node_modules: không đóng gói vào bundle.
  serverExternalPackages: ["mammoth", "read-excel-file", "sanitize-html"],
  // Worker nạp các gói này bằng require() (điểm vào CJS) còn Next chỉ vết theo import tĩnh (điểm vào ESM), nên bản standalone
  // thiếu tệp .cjs (vd read-excel-file/node/index.cjs). Ép chép trọn gói + phụ thuộc trực tiếp của read-excel-file.
  outputFileTracingIncludes: {
    "/api/files/\\[id\\]/view": [
      "./node_modules/read-excel-file/**/*",
      "./node_modules/saxen/**/*",
      "./node_modules/unzipper-esm/**/*",
      "./node_modules/worker-f/**/*",
      "./node_modules/fflate/**/*",
      "./node_modules/mammoth/**/*",
      "./node_modules/sanitize-html/**/*",
    ],
  },
  async headers() {
    return [
      // Mọi đường dẫn trừ /api/files/* và /api/(items|topics)/:id/icon: CSP đầy đủ, không cho nhúng khung.
      {
        source: "/((?!api/files/|api/(?:items|topics)/[^/]+/icon$).*)",
        headers: [
          ...common,
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // /api/files/*: KHÔNG đặt Content-Security-Policy ở đây. Header từ next.config GHI ĐÈ header của route (đã kiểm bằng
      // curl -I trên bản standalone), nên CSP (sandbox / default-src 'none' + frame-ancestors 'self') nằm hết trong
      // serveFile (src/server/services/files.ts). Ở đây chỉ thêm các header chung và X-Frame-Options: SAMEORIGIN.
      {
        source: "/api/files/:path*",
        headers: [...common, { key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      // Ảnh biểu tượng: cùng lý do (CSP của route nằm trong serveIcon, ADR 0004). img-src 'self' của CSP chung đã đủ cho <img>.
      {
        source: "/api/:kind(items|topics)/:id/icon",
        headers: [...common, { key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};
export default config;
