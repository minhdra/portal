import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Thư mục upload tạm cho test; global-setup xoá nó khi xong (chỉ xoá thư mục mang tiền tố này).
process.env.UPLOAD_DIR ??= path.join(os.tmpdir(), `portal-test-uploads-${process.pid}`);

// Test gửi IP qua X-Client-IP (mặc định của CLIENT_IP_HEADER) như khi đứng sau gateway.
process.env.TRUST_PROXY ??= "1";
process.env.SESSION_SECRET ??= "test-only-session-secret-0123456789abcdef";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/api/global-setup.ts"],
    fileParallelism: false, // dùng chung một Postgres
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
