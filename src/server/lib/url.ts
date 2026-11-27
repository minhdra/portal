/**
 * Chỉ nhận http(s)://host... hoặc đường dẫn nội bộ "/x". Trả URL đã chuẩn hoá hoặc null nếu không hợp lệ.
 * Khớp CHECK item_url_scheme trong DB.
 */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return null;
  if (s.startsWith("/")) {
    if (s.startsWith("//") || s.includes("\\")) return null;
    return s;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  if (u.username || u.password) return null; // chặn user:pass@host
  return u.toString();
}
