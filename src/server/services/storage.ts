import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "../env";

const KEY_RE = /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Đường dẫn tuyệt đối của storage_key; ném lỗi nếu khoá sai định dạng hoặc thoát khỏi UPLOAD_DIR. */
export function resolveKey(key: string): string {
  if (!KEY_RE.test(key)) throw new Error("storage_key không hợp lệ");
  const root = uploadDir();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("storage_key thoát khỏi UPLOAD_DIR");
  return full;
}

export function newStorageKey(now = new Date()): string {
  const yyyy = String(now.getUTCFullYear()).padStart(4, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/${randomUUID()}`;
}

export async function writeBlob(key: string, data: Uint8Array): Promise<void> {
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
  await fs.writeFile(full, data, { flag: "wx", mode: 0o640 });
}

/** Xoá blob; bỏ qua nếu đã mất. Lỗi khác chỉ log (blob mồ côi không được chặn thao tác xoá). */
export async function removeBlobs(keys: string[]): Promise<void> {
  for (const k of keys) {
    try {
      await fs.unlink(resolveKey(k));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("[storage] không xoá được blob:", (e as Error).message);
    }
  }
}
