import { afterEach, describe, expect, it, vi } from "vitest";
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
      "https://evil.com", "http://evil.com/x", "javascript:alert(1)", "evil.com", "", "/\u0085/evil.com", "///evil.com",
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
  it("TRUST_PROXY=1: phần tử ĐẦU của XFF, không phải phần tử cuối", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });
  it("CLIENT_IP_HEADER=cf-connecting-ip", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    expect(clientIp(req({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.9");
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
  });
  it("giá trị không phải IP -> unknown", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    expect(clientIp(req({ "x-forwarded-for": "<script>, 1.1.1.1" }))).toBe("unknown");
    expect(clientIp(req({}))).toBe("unknown");
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
