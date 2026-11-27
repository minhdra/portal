import { createHash, randomBytes } from "node:crypto";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
export const newToken = (): string => randomBytes(32).toString("base64url");

/** "Hà Nội" -> "ha-noi". Trả "" nếu không còn ký tự hợp lệ. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** Chuỗi liền mạch Unicode: cắt theo code point để không chẻ đôi cặp surrogate. */
export function truncateCp(s: string, n: number): string {
  const arr = Array.from(s);
  return arr.length > n ? arr.slice(0, n).join("") : s;
}
