/** Thư mục lưu file upload (tuyệt đối). Đọc lúc gọi để test đổi được. Mặc định khớp .env.example. */
export function uploadDir(): string {
  const dir = (process.env.UPLOAD_DIR?.trim() || "/data/uploads").replace(/\/+$/, "");
  if (!dir.startsWith("/")) throw new Error("UPLOAD_DIR phải là đường dẫn tuyệt đối");
  return dir;
}

/** Cookie ghim Secure khi COOKIE_SECURE=1 hoặc production: không phụ thuộc X-Forwarded-Proto (client giả được). */
export const cookieSecurePinned = (): boolean => process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production";
/** Khi Secure ghim: tên __Host- (trình duyệt buộc Secure, Path=/, không Domain). Dev http: tên thường. */
export const sessionCookieName = (): string => (cookieSecurePinned() ? "__Host-portal_session" : "portal_session");

/** TRUST_PROXY=1: tin header IP do proxy tin cậy (gateway) đặt. Mặc định tắt. */
export const trustProxy = (): boolean => process.env.TRUST_PROXY === "1";
/** Header chứa IP khách khi TRUST_PROXY=1 (mặc định x-forwarded-for; Cloudflare: cf-connecting-ip). */
export const clientIpHeader = (): string => (process.env.CLIENT_IP_HEADER?.trim() || "x-forwarded-for").toLowerCase();

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;
