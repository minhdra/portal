// Seed idempotent. Cần: DATABASE_URL, ADMIN_USER, ADMIN_INITIAL_PASSWORD (không ghi cứng mật khẩu).
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

const url = process.env.DATABASE_URL;
const adminUser = process.env.ADMIN_USER?.trim().toLowerCase();
const adminPass = process.env.ADMIN_INITIAL_PASSWORD;
if (!url) throw new Error("Thiếu DATABASE_URL");
if (!adminUser) throw new Error("Thiếu ADMIN_USER");
if (!adminPass || adminPass === "CHANGE_ME" || adminPass.length < 8) {
  throw new Error("ADMIN_INITIAL_PASSWORD thiếu, còn là CHANGE_ME hoặc ngắn hơn 8 ký tự");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Topic mẫu trung tính. Topic gốc: parentId null (không dùng upsert vì unique với NULL).
const roots = [
  { slug: "cong-cu", name: "Công cụ", icon: "wrench", sortOrder: 10 },
  { slug: "tai-lieu", name: "Tài liệu", icon: "book", sortOrder: 20 },
  { slug: "ghi-chu", name: "Ghi chú", icon: "note", sortOrder: 30 },
];
const children = [{ parent: "tai-lieu", slug: "huong-dan", name: "Hướng dẫn", sortOrder: 10 }];

async function main() {
  // Admin: chỉ tạo khi chưa có; chạy lại KHÔNG ghi đè mật khẩu đã đổi.
  const existing = await prisma.user.findUnique({ where: { username: adminUser! } });
  if (!existing) {
    const passwordHash = await argon2.hash(adminPass!, { type: argon2.argon2id });
    await prisma.user.create({
      data: { username: adminUser!, displayName: "Quản trị", passwordHash, mustChangePassword: true, role: "admin" },
    });
    console.log("Đã tạo admin (must_change_password=true)");
  } else {
    console.log("Admin đã tồn tại, bỏ qua");
  }

  const ids = new Map<string, string>();
  for (const r of roots) {
    let t = await prisma.topic.findFirst({ where: { parentId: null, slug: r.slug } });
    t ??= await prisma.topic.create({ data: r });
    ids.set(r.slug, t.id);
  }
  for (const c of children) {
    const parentId = ids.get(c.parent)!;
    await prisma.topic.upsert({
      where: { parentId_slug: { parentId, slug: c.slug } },
      update: {},
      create: { parentId, slug: c.slug, name: c.name, sortOrder: c.sortOrder },
    });
  }
  console.log("Seed xong");
}

main().finally(() => prisma.$disconnect());
