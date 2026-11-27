import { isIP } from "node:net";

/** Phân tích IPv6 (đã qua isIP) thành 8 nhóm 16 bit. Trả null nếu không phân tích được. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  // Đuôi IPv4 nhúng (::ffff:1.2.3.4): đổi thành 2 nhóm hex.
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const p = m[2]!.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => n > 255)) return null;
    s = `${m[1]}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (t: string) => (t === "" ? [] : t.split(":").map((g) => parseInt(g, 16)));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return all.length === 8 && all.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? all : null;
}

/**
 * Chuẩn hoá IP khách làm KHOÁ giới hạn tần suất. Không phải IP hợp lệ (hoặc có zone id `%`) -> null.
 * - IPv4: giữ nguyên. IPv4-mapped IPv6 (::ffff:a.b.c.d) -> IPv4.
 * - IPv6: gom theo /64 (một thuê bao thường được cấp cả /64, đổi 64 bit cuối là việc tầm thường): giữ 4 nhóm đầu,
 *   chữ thường, rút gọn "::" (vd 2001:DB8:0:1:aaaa::5 -> 2001:db8:0:1::). Giá trị này chỉ là khoá đại diện cho /64.
 */
export function normalizeClientIp(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.includes("%")) return null;
  const kind = isIP(v);
  if (kind === 4) return v;
  if (kind !== 6) return null;
  const g = ipv6Groups(v);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  const prefix = g.slice(0, 4);
  while (prefix.length && prefix[prefix.length - 1] === 0) prefix.pop();
  return `${prefix.map((x) => x.toString(16)).join(":")}::`;
}

/**
 * IP không định danh được một khách riêng: "unknown" hoặc địa chỉ riêng/loopback/link-local (RFC1918, 127/8, 169.254/16,
 * 100.64/10, fc00::/7, fe80::/10, ::1). Sau NAT/hairpin của router, nhiều khách thật cùng hiện ra một địa chỉ như vậy
 * (vd modem 192.168.1.1), nên khoá cứng theo IP/cặp sẽ thành khoá toàn cục. Với các IP này chỉ dùng backoff theo username.
 */
export function isSharedIp(ip: string): boolean {
  if (ip === "unknown" || ip === "" || ip === "::" || ip === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const h = ip.toLowerCase();
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
}
