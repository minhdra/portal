import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/generated/client";

const g = globalThis as unknown as { __portalPrisma?: PrismaClient };

function create(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu DATABASE_URL");
  // Ảnh biểu tượng (bytea, <= 64 KB) KHÔNG bao giờ được kéo theo mặc định: danh sách item/topic chỉ cần iconUpdatedAt.
  // Chỉ services/icons.ts chọn tường minh `iconImage: true` (select thắng omit toàn cục). Xem ADR 0004.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), omit: { item: { iconImage: true }, topic: { iconImage: true } } });
}

/** Một PrismaClient cho cả tiến trình (tránh tràn kết nối khi hot reload). */
export const prisma: PrismaClient = (g.__portalPrisma ??= create());

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type Db = PrismaClient | Tx;
