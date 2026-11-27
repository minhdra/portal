import type { Item, ItemType } from "./types";

export const TYPE_LABEL: Record<ItemType, string> = { tool: "Tool", web: "Web", doc: "Tài liệu", note: "Ghi chú", link: "Link" };
export const TYPE_ICON: Record<ItemType, string> = { tool: "tool", web: "web", doc: "doc", note: "note", link: "link" };
export const ICON_CHOICES: [string, string][] = [
  ["tool", "Công cụ"], ["web", "Web"], ["doc", "Tài liệu"], ["note", "Ghi chú"], ["map", "Bản đồ"], ["database", "Dữ liệu"],
  ["server", "Máy chủ"], ["cloud", "Đám mây"], ["folder", "Thư mục"], ["link", "Liên kết"], ["image", "Hình ảnh"], ["sheet", "Bảng tính"],
];

export function iconOf(item: Pick<Item, "icon" | "type">): string {
  return item.icon || TYPE_ICON[item.type];
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const day = Math.floor((startOfDay(today) - startOfDay(d)) / 86400000);
  if (day === 0) return `${hm} hôm nay`;
  if (day === 1) return `${hm} hôm qua`;
  if (day < 7 && day > 0) return `${day} ngày trước`;
  return `${d.toLocaleDateString("vi-VN")} ${hm}`;
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Chỉ cho http(s) hoặc đường dẫn nội bộ "/x" (không "//"). */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^\/(?!\/)/.test(u)) return u;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}
export const isInternal = (u: string) => u.startsWith("/");
export function hostOf(u: string): string {
  if (isInternal(u)) return u;
  try { return new URL(u).host; } catch { return u; }
}

export function fileKind(mime: string, name: string): "pdf" | "image" | "docx" | "xlsx" | "text" | "other" {
  const n = name.toLowerCase();
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (n.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx";
  if (n.endsWith(".xlsx") || mime.includes("spreadsheetml")) return "xlsx";
  if (mime.startsWith("text/") || n.endsWith(".md") || n.endsWith(".txt")) return "text";
  return "other";
}
export const fileIcon = (k: ReturnType<typeof fileKind>) =>
  ({ pdf: "pdf", image: "image", docx: "doc", xlsx: "sheet", text: "note", other: "doc" })[k];
