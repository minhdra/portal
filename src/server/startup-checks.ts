import { deviceSecret, trustProxy } from "./env";

/** Cảnh báo cấu hình nguy hiểm khi chạy production (in lúc khởi động, xem src/instrumentation.ts và ADR 0002). */
export function productionWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const w: string[] = [];
  if (!trustProxy()) {
    w.push(
      "TRUST_PROXY chưa bật: mọi người dùng bị coi chung IP \"unknown\", giới hạn đăng nhập theo IP/cặp bị tắt, chỉ còn làm chậm theo username. " +
        "Đặt TRUST_PROXY=1 (và CLIENT_IP_HEADER=x-client-ip) khi chạy sau gateway tin cậy.",
    );
  }
  if (!deviceSecret()) {
    w.push("SESSION_SECRET thiếu hoặc ngắn hơn 32 ký tự: tắt cookie \"thiết bị quen\" (chủ tài khoản ở IP mới không được miễn làm chậm khi bị dò).");
  }
  return w;
}
