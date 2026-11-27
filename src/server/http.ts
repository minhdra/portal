import { ZodError, type ZodType } from "zod";
import { Prisma } from "../../prisma/generated/client";
import { clientIpHeader, cookieSecurePinned, trustProxy } from "./env";
import { ApiError, invalid } from "./errors";
import { normalizeClientIp } from "./lib/ip";
import { loadSession, type SessionUser } from "./services/auth";

export interface Ctx {
  req: Request;
  params: Record<string, string>;
  user: SessionUser;
  sessionId: string;
  ip: string;
  url: URL;
  /** Đọc + kiểm tra JSON body (giới hạn kích thước). */
  body<T>(schema: ZodType<T>, maxBytes?: number): Promise<T>;
}

export interface PublicCtx extends Omit<Ctx, "user" | "sessionId"> {
  user: SessionUser | null;
  sessionId: string | null;
}

type Params = { params: Promise<Record<string, string>> };
type Mode = "required" | "none" | "allowMustChange";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * IP khách (khoá giới hạn tần suất). TRUST_PROXY tắt: không tin header nào (Request của route handler không lộ IP
 * socket) -> "unknown". TRUST_PROXY=1: đọc CLIENT_IP_HEADER (mặc định `x-client-ip`, do gateway ĐẶT/ghi đè bằng
 * $remote_addr sau real_ip_header CF-Connecting-IP; portal không publish cổng nên chỉ gateway chạm được) và tin nguyên
 * giá trị đó. `x-forwarded-for` lấy phần tử CUỐI (phần do proxy gần nhất thêm). Giá trị không phải IP hợp lệ
 * (kể cả nhiều giá trị ghép bằng dấu phẩy ở header khác) -> "unknown". IPv6 chuẩn hoá về /64. Xem ADR 0002.
 */
export function clientIp(req: Request): string {
  if (!trustProxy()) return "unknown";
  const name = clientIpHeader();
  let v = req.headers.get(name);
  if (v && name === "x-forwarded-for") v = v.split(",").pop() ?? null;
  return (v && normalizeClientIp(v)) || "unknown";
}

/** Secure: ghim bởi COOKIE_SECURE=1/production; ngoài ra (dev) theo X-Forwarded-Proto hoặc scheme URL. */
export function isSecureRequest(req: Request): boolean {
  if (cookieSecurePinned()) return true;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** CSRF: yêu cầu ghi phải có Origin cùng host với Host/X-Forwarded-Host. */
export function checkOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) throw new ApiError("forbidden", "Thiếu Origin.");
  let oh: string;
  try {
    oh = new URL(origin).host;
  } catch {
    throw new ApiError("forbidden", "Origin không hợp lệ.");
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host).split(",")[0]!.trim();
  if (oh.toLowerCase() !== host.toLowerCase()) throw new ApiError("forbidden", "Origin không khớp.");
}

export function json(data: unknown, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const h = new Headers(init.headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status: init.status ?? 200, headers: h });
}

export const noContent = (headers?: HeadersInit): Response => new Response(null, { status: 204, headers });

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    const { headers, fields, ...rest } = e.extra ?? {};
    return json(
      { error: { code: e.code, message: e.message, ...(fields ? { fields } : {}), ...rest } },
      { status: e.status, headers: headers as HeadersInit | undefined },
    );
  }
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
    return errorResponse(invalid("Dữ liệu không hợp lệ.", fields));
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return errorResponse(new ApiError("conflict", "Giá trị đã tồn tại."));
    if (e.code === "P2025") return errorResponse(new ApiError("not_found", "Không tìm thấy."));
    if (e.code === "P2003") return errorResponse(new ApiError("conflict", "Dữ liệu đang được tham chiếu."));
  }
  console.error("[api] lỗi không mong đợi:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
  return json({ error: { code: "internal", message: "Lỗi máy chủ." } }, { status: 500 });
}

export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) throw new ApiError("payload_too_large", "Dữ liệu gửi lên quá lớn.");
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError("payload_too_large", "Dữ liệu gửi lên quá lớn.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function makeCtx(req: Request, params: Record<string, string>): Omit<PublicCtx, "user" | "sessionId"> {
  return {
    req,
    params,
    ip: clientIp(req),
    url: new URL(req.url),
    async body<T>(schema: ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
      const buf = await readBodyLimited(req, maxBytes);
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buf));
      } catch {
        throw invalid("Nội dung gửi lên không phải JSON hợp lệ.");
      }
      return schema.parse(raw);
    },
  };
}

/** Bọc route handler: CSRF -> xác thực -> mustChangePassword -> handler -> chuẩn hoá lỗi. */
export function route(mode: "none", fn: (c: PublicCtx) => Promise<Response>): (req: Request, p: Params) => Promise<Response>;
export function route(mode: "required" | "allowMustChange", fn: (c: Ctx) => Promise<Response>): (req: Request, p: Params) => Promise<Response>;
export function route(mode: Mode, fn: (c: never) => Promise<Response>): (req: Request, p: Params) => Promise<Response> {
  return async (req, p) => {
    try {
      if (!SAFE.has(req.method)) checkOrigin(req);
      const base = makeCtx(req, (await p?.params) ?? {});
      let session: Awaited<ReturnType<typeof loadSession>> = null;
      if (mode !== "none") {
        session = await loadSession(req);
        if (!session) throw new ApiError("unauthenticated", "Bạn chưa đăng nhập.");
        if (mode === "required" && session.user.mustChangePassword) {
          throw new ApiError("must_change_password", "Bạn cần đổi mật khẩu trước khi tiếp tục.");
        }
      }
      const ctx = { ...base, user: session?.user ?? null, sessionId: session?.sessionId ?? null };
      return await (fn as (c: unknown) => Promise<Response>)(ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
  const o: Record<string, string> = {};
  for (const [k, v] of url.searchParams) o[k] ??= v;
  return schema.parse(o);
}
