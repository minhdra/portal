import { ApiError } from "../errors";

/**
 * Giới hạn số tác vụ chạy đồng thời (argon2, upload, worker parse). Hàng đợi có trần:
 * vượt trần -> 429 ngay thay vì dồn bộ nhớ/CPU vô hạn.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(
    private readonly max: number,
    private readonly maxQueue = 64,
    private readonly busyMessage = "Máy chủ đang bận. Vui lòng thử lại sau ít giây.",
  ) {}

  get running(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiters.length >= this.maxQueue) {
        throw new ApiError("rate_limited", this.busyMessage, { headers: { "Retry-After": "5" } });
      }
      // Nhường slot trực tiếp: release() không giảm active khi có người chờ.
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
