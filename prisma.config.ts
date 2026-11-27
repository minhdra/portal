import { defineConfig } from "prisma/config";

// DATABASE_URL lấy từ môi trường (không đọc/ghi .env ở đây; repo public).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
