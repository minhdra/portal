# ADR 0002: Giới hạn đăng nhập

Trạng thái: chấp nhận (28/11/2026, sau review bảo mật wave 2). Thay cách làm "đếm rồi mới ghi" của wave 2.

## Vấn đề
1. Kiểm tra (đếm lần sai) và ghi (lần sai mới) là hai bước tách rời, lại ghi SAU khi chạy argon2 (~50 ms). 200 request song song cùng lọt qua bước đếm khi bảng còn rỗng, nên một cặp (username, ip) đoán được hàng trăm mật khẩu thay vì 5.
2. Khoá theo username cứng (30 lần/15 phút, mọi IP) cho người lạ khoá admin: gửi 30 lần sai là admin không đăng nhập được 15 phút, lặp lại mãi.
3. Khoá đổi mật khẩu dùng tiền tố `cp:` trong cột `username`, trộn với username đăng nhập thật.
4. IP lấy từ phần tử cuối `X-Forwarded-For`/`X-Real-IP` mà không hỏi có đứng sau proxy tin cậy không.

## Quyết định
- **Đặt chỗ trước khi verify.** `reserveAttempt` chạy trong một giao dịch: `pg_advisory_xact_lock` theo `(kind, username)` và theo `ip` (lấy theo thứ tự cố định để không deadlock), đếm, rồi ghi ngay một hàng `success=false`. Lần thứ 6 thấy 5 hàng đặt chỗ nên bị từ chối trước khi tốn argon2. Đăng nhập đúng thì `finishAttempt` xoá các lần sai của cặp và ghi hàng `success`. Hàng đặt chỗ mồ côi (tiến trình chết) vẫn tính là sai: hỏng theo hướng chặn. Khoá advisory chỉ giữ trong giao dịch ngắn (không giữ khi chạy argon2).
- **Giới hạn cứng** giữ nguyên cho (kind, username, ip): 5 lần/15 phút, và cho ip: 30 lần/15 phút (mọi username, mọi kind).
- **Giới hạn theo username (mọi IP) là làm chậm dần**, không khoá: sau 10 lần sai trong cửa sổ, lần thử kế tiếp phải cách lần sai gần nhất >= min(1 s * 2^(n-10), 60 s), nếu không thì 429 + `Retry-After` (số giây còn lại). Lượt bị từ chối không ghi hàng nên người lạ không tự kéo dài thêm hạn. Chủ tài khoản đã có phiên từ chính IP đó (bảng `session`, hạn tới 60 ngày) được **miễn** bước này, nên người lạ không chặn được admin đang dùng IP quen; vẫn bị giới hạn cứng theo cặp. Đánh đổi: admin đăng nhập từ IP mới đúng lúc bị tấn công phải chờ tối đa 60 s; kẻ tấn công vẫn dò được tối đa ~1 lần/phút theo username (rẻ hơn khoá cứng nhưng không về 0): dựa vào mật khẩu mạnh + argon2.
- **Cột `login_attempt.kind`** (`login`|`cp`, CHECK) thay tiền tố `cp:`. Migration chuyển các hàng `cp:<u>` cũ sang `kind='cp'`.
- **Giới hạn đồng thời argon2**: tối đa 4 phép băm cùng lúc, hàng đợi 100, quá thì 429. Chặn kẻ gửi hàng nghìn request làm cạn CPU/RAM.
- **IP khách**: `TRUST_PROXY=1` mới tin header; mặc định `X-Forwarded-For` lấy phần tử ĐẦU (nginx của gateway phải đặt lại header: `proxy_set_header X-Forwarded-For $remote_addr`, không `$proxy_add_x_forwarded_for`), hoặc `CLIENT_IP_HEADER=cf-connecting-ip` sau Cloudflare. Giá trị không phải IP hợp lệ -> `unknown`. `TRUST_PROXY` tắt -> luôn `unknown` (Request của route handler không lộ IP socket), tức mọi người dùng chung một bộ đếm IP: chỉ chấp nhận cho dev, không chạy production kiểu đó. Phần tử đầu là giá trị client tự đặt nếu proxy không ghi đè, nên cấu hình proxy là điều kiện bắt buộc.

## Hệ quả
- Test hồi quy: `tests/api/hardening.test.ts` (200 request song song, backoff theo username, kind tách riêng) và `tests/unit/pure.test.ts` (clientIp).
- Bảng `login_attempt` vẫn do job dọn 24 giờ; lượt 429 không ghi hàng nên lũ request bị từ chối không phình bảng.
