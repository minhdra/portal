import { z } from "zod";
import { normalizeUrl } from "./lib/url";
import { isUuid } from "./lib/util";

const noCtl = (s: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);

export const uuid = z.string().refine(isUuid, "Mã không hợp lệ");
export const shortText = (max: number, label = "Giá trị") =>
  z.string().trim().min(1, `${label} không được để trống`).max(max, `${label} tối đa ${max} ký tự`).refine(noCtl, "Chứa ký tự không hợp lệ");
export const optText = (max: number) =>
  z.string().trim().max(max, `Tối đa ${max} ký tự`).refine(noCtl, "Chứa ký tự không hợp lệ");

/** URL: http(s) hoặc "/x"; chuỗi rỗng = không có. Trả URL chuẩn hoá. */
export const urlField = z.string().max(2048, "URL quá dài").transform((s, ctx) => {
  if (s.trim() === "") return null;
  const n = normalizeUrl(s);
  if (n === null) {
    ctx.addIssue({ code: "custom", message: "URL không hợp lệ (chỉ http(s) hoặc đường dẫn nội bộ bắt đầu bằng /)" });
    return z.NEVER;
  }
  return n;
});

export const itemType = z.enum(["tool", "web", "doc", "note", "link"]);
export const itemStatus = z.enum(["active", "draft", "archived"]);
