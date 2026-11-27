import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default function setup() {
  const url = process.env.DATABASE_URL ?? "";
  // Test xoá dữ liệu: chỉ chạy với Postgres cục bộ.
  if (!/@(127\.0\.0\.1|localhost):\d+\//.test(url)) {
    throw new Error("Test tích hợp cần DATABASE_URL trỏ tới Postgres cục bộ (127.0.0.1/localhost) đã migrate.");
  }
  return () => {
    const dir = process.env.UPLOAD_DIR ?? "";
    if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith("portal-test-uploads-")) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
