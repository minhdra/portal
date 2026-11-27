/**
 * Chuẩn hoá tham số `?next=` sau đăng nhập: chỉ nhận đường dẫn cùng origin, ngược lại về "/".
 * Chặn: ký tự điều khiển/tab/newline (trình duyệt bỏ chúng nên "/\t/evil.com" thành "//evil.com"),
 * "//host", "/\host", và mọi chuỗi mà new URL(n, origin) cho ra origin khác.
 */
export function sanitizeNext(n: string | null | undefined, origin: string): string {
  if (!n || n.length > 2048) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(n)) return "/";
  if (!/^\/(?![/\\])/.test(n)) return "/";
  try {
    const u = new URL(n, origin);
    if (u.origin !== origin) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
