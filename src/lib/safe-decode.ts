/** decodeURIComponent ném URIError với "%" lẻ (vd "%E0%A4%A"): giữ nguyên chuỗi thay vì làm sập render. */
export function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
