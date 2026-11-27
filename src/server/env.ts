/** Thư mục lưu file upload (tuyệt đối). Đọc lúc gọi để test đổi được. Mặc định khớp .env.example. */
export function uploadDir(): string {
  const dir = (process.env.UPLOAD_DIR?.trim() || "/data/uploads").replace(/\/+$/, "");
  if (!dir.startsWith("/")) throw new Error("UPLOAD_DIR phải là đường dẫn tuyệt đối");
  return dir;
}

export const SESSION_COOKIE = "portal_session";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;
