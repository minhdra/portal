import { cleanupExpired } from "./services/auth";

const g = globalThis as unknown as { __portalJobs?: NodeJS.Timeout };
const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Dọn session hết hạn + login_attempt cũ: chạy ngay khi khởi động rồi mỗi 6 giờ. Gọi nhiều lần vẫn chỉ 1 timer. */
export function startJobs(): void {
  if (g.__portalJobs) return;
  const run = () => {
    cleanupExpired().catch((e) => console.error("[jobs] cleanup lỗi:", e instanceof Error ? e.message : e));
  };
  run();
  g.__portalJobs = setInterval(run, SIX_HOURS);
  g.__portalJobs.unref();
}
