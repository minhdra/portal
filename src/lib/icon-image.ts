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

function toBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => c.toBlob(res, "image/png"));
}

/** Lấy phần giữa hình vuông cạnh min(w,h) của ảnh, vẽ vào canvas size×size (trong suốt), xuất PNG. */
export async function prepareIcon(file: Blob): Promise<PreparedIcon> {
  if (!OK_TYPES.has(file.type)) throw new IconError("Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF.");
  if (file.size > MAX_SOURCE_BYTES) throw new IconError("Ảnh quá lớn (tối đa 12 MB trước khi thu nhỏ).");
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
