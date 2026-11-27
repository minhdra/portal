import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/services/auth";

export const ORIGIN = "http://portal.test";
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface CallOpts {
  method?: string;
  body?: unknown;
  form?: FormData;
  cookie?: string | null;
  ip?: string;
  origin?: string | null;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

export async function call(h: Handler, path: string, o: CallOpts = {}): Promise<Response> {
  const method = o.method ?? "GET";
  const url = new URL(path, ORIGIN);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const headers = new Headers({ host: "portal.test", "x-client-ip": o.ip ?? "10.0.0.1", ...o.headers });
  if (o.origin !== null && method !== "GET" && method !== "HEAD") headers.set("origin", o.origin ?? ORIGIN);
  if (o.cookie) headers.set("cookie", o.cookie);
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.body !== undefined) {
    headers.set("content-type", "application/json");
    body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
  }
  return h(new Request(url, { method, headers, body }), { params: Promise.resolve(o.params ?? {}) });
}

export async function jsonOf<T = any>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

export const rnd = (n = 6) => randomBytes(n).toString("hex");
const ipCounter = { n: 0 };
export const freshIp = () => `10.${(Date.now() >> 8) & 255}.${ipCounter.n++ % 250}.${Math.floor(Math.random() * 250)}`;

export async function makeUser(opts: { mustChange?: boolean; role?: "admin" | "user" } = {}) {
  const username = `t${rnd(6)}`;
  const password = `pw-${rnd(10)}`;
  const u = await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password), mustChangePassword: opts.mustChange ?? false, role: opts.role ?? "admin", displayName: "Tester" },
  });
  return { id: u.id, username, password };
}

export async function loginCookie(username: string, password: string, ip = freshIp()): Promise<string> {
  const { POST } = await import("@/app/api/auth/login/route");
  const r = await call(POST, "/api/auth/login", { method: "POST", body: { username, password }, ip });
  if (r.status !== 200) throw new Error(`login thất bại: ${r.status}`);
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

/** Người dùng đã đăng nhập sẵn (không phải đổi mật khẩu). */
export async function session() {
  const u = await makeUser();
  const cookie = await loginCookie(u.username, u.password);
  return { ...u, cookie };
}

export async function resetData() {
  // Chỉ gọi khi global-setup đã xác nhận DB cục bộ.
  await prisma.$executeRawUnsafe(`TRUNCATE item_tag, tag, note_version, note, file, item, topic RESTART IDENTITY CASCADE`);
}
