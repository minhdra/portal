import { afterEach, describe, expect, it, vi } from "vitest";
import { readImageSize, MAX_SOURCE_PIXELS } from "@/lib/icon-image";
import { safeDecode } from "@/lib/safe-decode";
import { sanitizeNext } from "@/lib/safe-next";
import { Semaphore } from "@/server/lib/semaphore";
import { clientIp, isSecureRequest } from "@/server/http";
import { sessionCookieName } from "@/server/env";

const O = "https://portal.example";

describe("sanitizeNext (L1)", () => {
  it("giữ đường dẫn cùng origin", () => {
    expect(sanitizeNext("/items/abc?x=1#h", O)).toBe("/items/abc?x=1#h");
    expect(sanitizeNext("/", O)).toBe("/");
  });
  it("chặn open redirect các kiểu", () => {
    for (const bad of [
      "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\u0000/evil.com",
      "https://evil.com", "http://evil.com/x", "javascript:alert(1)", "evil.com", "", "/\u0085/evil.com", "///evil.com", "/.//evil.com", "/..//evil.com", "/a/..//evil.com", "/%2e//evil.com",
    ]) {
      expect(sanitizeNext(bad, O), JSON.stringify(bad)).toBe("/");
    }
    expect(sanitizeNext(null, O)).toBe("/");
    expect(sanitizeNext("/" + "a".repeat(3000), O)).toBe("/");
  });
});

describe("safeDecode (L6)", () => {
  it("không ném với % lẻ", () => {
    expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A");
    expect(safeDecode("a%20b")).toBe("a b");
  });
});

describe("Semaphore (L3)", () => {
  it("giới hạn đồng thời và hàng đợi", async () => {
    const sem = new Semaphore(2, 1);
    let cur = 0, peak = 0;
    const gate: (() => void)[] = [];
    const task = () => sem.run(async () => { cur++; peak = Math.max(peak, cur); await new Promise<void>((r) => gate.push(r)); cur--; });
    const ps = [task(), task(), task()]; // 2 chạy + 1 chờ
    await expect(task()).rejects.toMatchObject({ code: "rate_limited" }); // hàng đợi đầy
    await new Promise((r) => setTimeout(r, 10));
    expect(peak).toBe(2);
    while (gate.length || cur) { gate.shift()?.(); await new Promise((r) => setTimeout(r, 5)); }
    await Promise.all(ps);
    expect(peak).toBe(2);
    expect(sem.running).toBe(0);
  });
});

describe("clientIp (M2) / cookie (M4)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (h: Record<string, string>, url = "http://x.test/") => new Request(url, { headers: h });

  it("TRUST_PROXY tắt: bỏ qua mọi header", () => {
    vi.stubEnv("TRUST_PROXY", "");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" }))).toBe("unknown");
  });
  it("TRUST_PROXY=1, mặc định đọc x-client-ip nguyên giá trị; bỏ qua XFF/CF", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    vi.stubEnv("CLIENT_IP_HEADER", "");
    expect(clientIp(req({ "x-client-ip": "203.0.113.7", "x-forwarded-for": "9.9.9.9", "cf-connecting-ip": "8.8.8.8" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
    // nhiều giá trị ghép (proxy không ghi đè) không được tin
    expect(clientIp(req({ "x-client-ip": "1.1.1.1, 2.2.2.2" }))).toBe("unknown");
  });
  it("CLIENT_IP_HEADER=x-forwarded-for: lấy phần tử CUỐI (do proxy gần nhất thêm)", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    vi.stubEnv("CLIENT_IP_HEADER", "x-forwarded-for");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });
  it("CLIENT_IP_HEADER=cf-connecting-ip", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    expect(clientIp(req({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.9");
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
  });
  it("giá trị không phải IP -> unknown", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    expect(clientIp(req({ "x-client-ip": "<script>" }))).toBe("unknown");
    expect(clientIp(req({ "x-client-ip": "fe80::1%eth0" }))).toBe("unknown");
    expect(clientIp(req({}))).toBe("unknown");
  });
  it("IPv6 chuẩn hoá: chữ thường, rút gọn, gom theo /64; IPv4-mapped -> IPv4", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    const ip = (v: string) => clientIp(req({ "x-client-ip": v }));
    // cùng /64, viết khác nhau (hoa/thường, đầy đủ/rút gọn, 64 bit cuối khác) -> cùng khoá
    const k = ip("2001:db8:0:1::5");
    expect(k).toBe("2001:db8:0:1::");
    expect(ip("2001:DB8:0000:0001:aaaa:bbbb:cccc:dddd")).toBe(k);
    expect(ip("2001:0db8:0:1:0:0:0:1")).toBe(k);
    // /64 khác -> khoá khác
    expect(ip("2001:db8:0:2::5")).not.toBe(k);
    expect(ip("2001:db8::1")).toBe("2001:db8::");
    expect(ip("::1")).toBe("::");
    expect(ip("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ip("203.0.113.7")).toBe("203.0.113.7");
  });
  it("COOKIE_SECURE=1 hoặc production: luôn Secure + tên __Host-", () => {
    expect(sessionCookieName()).toBe("portal_session");
    expect(isSecureRequest(req({ "x-forwarded-proto": "http" }))).toBe(false);
    vi.stubEnv("COOKIE_SECURE", "1");
    expect(isSecureRequest(req({ "x-forwarded-proto": "http" }))).toBe(true);
    expect(sessionCookieName()).toBe("__Host-portal_session");
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    expect(isSecureRequest(req({}))).toBe(true);
    expect(sessionCookieName()).toBe("__Host-portal_session");
  });
});

describe("productionWarnings (F2)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("production + TRUST_PROXY tắt -> cảnh báo; bật + SESSION_SECRET đủ dài -> không; không phải production -> không", async () => {
    const { productionWarnings } = await import("@/server/startup-checks");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUST_PROXY", "");
    vi.stubEnv("SESSION_SECRET", "x".repeat(40));
    expect(productionWarnings().join(" ")).toMatch(/TRUST_PROXY/);
    vi.stubEnv("TRUST_PROXY", "1");
    expect(productionWarnings()).toEqual([]);
    vi.stubEnv("SESSION_SECRET", "ngan");
    expect(productionWarnings().join(" ")).toMatch(/SESSION_SECRET/);
    vi.stubEnv("NODE_ENV", "test");
    expect(productionWarnings()).toEqual([]);
  });
});

describe("next.config headers (F7)", () => {
  it("/api/files/* không đặt Content-Security-Policy (header cấu hình ghi đè header route); trang khác có CSP + frame-ancestors 'none'", async () => {
    const cfg = (await import("../../next.config")).default;
    const rules = await cfg.headers!();
    const keys = (src: string) => rules.find((r) => r.source === src)!.headers.map((h) => h.key.toLowerCase());
    expect(keys("/api/files/:path*")).not.toContain("content-security-policy");
    expect(keys("/api/files/:path*")).toContain("x-frame-options");
    const generic = rules.find((r) => r.headers.some((h) => h.key.toLowerCase() === "content-security-policy"))!;
    expect(generic.headers.map((h) => h.key.toLowerCase())).toContain("content-security-policy");
    // Ảnh biểu tượng (ADR 0004): CSP do route đặt; cấu hình không được ghi đè.
    expect(keys("/api/:kind(items|topics)/:id/icon")).not.toContain("content-security-policy");
    const re = new RegExp("^" + generic.source.replace(/^\//, "/") + "$");
    for (const p of ["/api/items/abc/icon", "/api/topics/abc/icon", "/api/files/x"]) expect(re.test(p), p).toBe(false);
    for (const p of ["/", "/items/abc", "/topic/abc", "/api/items/abc", "/api/items/abc/files", "/api/items/abc/icon/x"]) expect(re.test(p), p).toBe(true);
  });
});

describe("readImageSize (chặn pixel bomb ở client)", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  it("PNG: đọc đúng kích thước, 20000x20000 vượt trần", () => {
    expect(readImageSize(png(64, 32))).toEqual({ w: 64, h: 32 });
    const big = readImageSize(png(20000, 20000))!;
    expect(big.w * big.h).toBeGreaterThan(MAX_SOURCE_PIXELS);
  });
  it("GIF/JPEG/WebP đọc được, rác trả null", () => {
    const gif = new Uint8Array(13); gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
    expect(readImageSize(gif)).toEqual({ w: 320, h: 240 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0]);
    expect(readImageSize(jpg)).toEqual({ w: 640, h: 480 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0x7f, 0, 0, 0x3f, 0, 0]);
    expect(readImageSize(webp)).toEqual({ w: 128, h: 64 });
    expect(readImageSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
});
