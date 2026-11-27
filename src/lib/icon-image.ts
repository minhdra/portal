/** Chuẩn bị ảnh biểu tượng ở trình duyệt: thu nhỏ về PNG vuông, nền trong suốt, cắt giữa (ADR 0004). */

export const ICON_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const OK_TYPES = new Set(ICON_ACCEPT.split(","));
/** Trần dung lượng ảnh gốc đem giải mã (chặn ảnh khổng lồ làm treo tab). */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
/** Server nhận tối đa 64 KB. */
export const ICON_MAX_BYTES = 64 * 1024;
/** Kích thước thử lần lượt nếu PNG 128 vẫn > 64 KB (ảnh nhiều chi tiết). */
const SIZES = [128, 96, 64];

export interface PreparedIcon {
  blob: Blob;
  /** data: URL để xem trước (CSP img-src cho phép data:, không cho blob:). */
  dataUrl: string;
}

export class IconError extends Error {}

/** Trần số điểm ảnh của ảnh gốc: chặn "pixel bomb" (PNG/GIF 20000x20000 chỉ vài trăm KB nhưng giải mã tốn ~1,6 GB). */
export const MAX_SOURCE_PIXELS = 40_000_000;

/** Đọc rộng x cao từ header (PNG, GIF, JPEG, WebP) mà KHÔNG giải mã; null nếu không nhận ra. */
export function readImageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16 = (o: number) => b[o] | (b[o + 1] << 8); // little-endian
  const be16 = (o: number) => (b[o] << 8) | b[o + 1];
  const be32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: be32(16), h: be32(20) };
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: u16(6), h: u16(8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m === 0xff) { o++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: be16(o + 5), w: be16(o + 7) };
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
      o += 2 + be16(o + 2);
    }
    return null;
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const t = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (t === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (t === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }; }
    if (t === "VP8 ") return { w: u16(26) & 0x3fff, h: u16(28) & 0x3fff };
  }
  return null;
}

function toBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => c.toBlob(res, "image/png"));
}

/** Lấy phần giữa hình vuông cạnh min(w,h) của ảnh, vẽ vào canvas size×size (trong suốt), xuất PNG. */
export async function prepareIcon(file: Blob): Promise<PreparedIcon> {
  if (!OK_TYPES.has(file.type)) throw new IconError("Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF.");
  if (file.size > MAX_SOURCE_BYTES) throw new IconError("Ảnh quá lớn (tối đa 12 MB trước khi thu nhỏ).");
  // Kích thước đọc từ header trước khi giải mã; không đọc được hoặc quá lớn thì từ chối.
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const dim = readImageSize(head);
  if (!dim || dim.w < 1 || dim.h < 1) throw new IconError("Không đọc được kích thước ảnh. Hãy thử ảnh khác.");
  if (dim.w * dim.h > MAX_SOURCE_PIXELS) throw new IconError("Ảnh có quá nhiều điểm ảnh (tối đa khoảng 40 triệu). Hãy thu nhỏ trước.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new IconError("Không đọc được ảnh này. Hãy thử ảnh khác.");
  }
  try {
    const side = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - side) / 2;
    const sy = (bmp.height - side) / 2;
    for (const size of SIZES) {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) throw new IconError("Trình duyệt không hỗ trợ thu nhỏ ảnh.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
      const blob = await toBlob(c);
      if (blob && blob.size <= ICON_MAX_BYTES) return { blob, dataUrl: c.toDataURL("image/png") };
    }
  } finally {
    bmp.close();
  }
  throw new IconError("Ảnh quá phức tạp để làm biểu tượng nhỏ hơn 64 KB. Hãy chọn ảnh đơn giản hơn.");
}

/** Trạng thái ảnh biểu tượng trong form (chưa gửi lên máy chủ cho tới khi bấm Lưu). */
export interface IconImageState {
  /** Địa chỉ đang hiển thị: ảnh hiện có (/api/.../icon?v=) hoặc data: URL của ảnh mới chọn; null nếu không có. */
  url: string | null;
  /** Ảnh mới cần PUT. */
  blob: Blob | null;
  /** Người dùng đã đổi (chọn ảnh mới hoặc bỏ ảnh). */
  dirty: boolean;
}
export const iconStateOf = (url: string | null | undefined): IconImageState => ({ url: url ?? null, blob: null, dirty: false });
