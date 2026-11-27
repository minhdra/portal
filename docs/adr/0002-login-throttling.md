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
- **Giới hạn đồng thời argon2**: tối đa **2** phép băm cùng lúc (libuv chỉ có 4 luồng, dùng chung cho fs/dns/zlib: để chừa chỗ cho đọc file), hàng đợi 100, quá thì 429. Máy nhiều nhân có thể đặt `UV_THREADPOOL_SIZE=8` trong môi trường container rồi nâng cổng. Hash giả (user không tồn tại) cũng đi qua cổng này và không cache lỗi. Lượt bị cổng từ chối (429 "máy chủ bận") chưa thử mật khẩu nào nên **không tính là lần sai** (xoá hàng đặt chỗ rồi ném lại); đổi mật khẩu gọi `finishAttempt` ngay sau khi verify đúng, trước kiểm tra "mới trùng cũ".
- **IP khách (quyết định 28/11, vòng 2).** Chuỗi triển khai: Cloudflare tunnel -> gateway nginx -> portal. Portal KHÔNG publish cổng ra host, chỉ gateway chạm được. Gateway dùng `real_ip_header CF-Connecting-IP` rồi **đặt (ghi đè, không append)** `proxy_set_header X-Client-IP $remote_addr`. Portal, khi `TRUST_PROXY=1`, đọc `CLIENT_IP_HEADER` (mặc định `x-client-ip`) và tin nguyên giá trị; không dùng phần tử đầu của `X-Forwarded-For` (client tự đặt được). Các tuỳ chọn còn lại: `cf-connecting-ip`; `x-forwarded-for` (lấy phần tử CUỐI, do proxy gần nhất thêm). Giá trị không phải IP hợp lệ (kể cả nhiều giá trị ghép dấu phẩy, zone id `%`) -> `unknown`. **IPv6 chuẩn hoá**: chữ thường, rút gọn, gom theo /64 (khoá `2001:db8:0:1::`), IPv4-mapped -> IPv4; một thuê bao thường có cả /64 nên khoá theo địa chỉ đầy đủ sẽ bị vượt bằng cách xoay 64 bit cuối. `.env.example` mặc định `TRUST_PROXY=1`, `CLIENT_IP_HEADER=x-client-ip`.
- **`TRUST_PROXY` tắt (hành vi chọn)**: mọi người dùng chung IP `unknown` (Request của route handler không lộ IP socket). Khi đó giới hạn cứng theo IP (30) và theo cặp (5) sẽ thành khoá TOÀN CỤC (30 lần sai của bất kỳ ai khoá cả site, 5 lần sai khoá admin với mọi người), tệ nhất có thể. Lựa chọn: với `unknown` **bỏ cả hai khoá cứng**, chỉ còn backoff theo username (tối đa ~1 lần đoán/phút sau 10 lần sai, người lạ không khoá được ai quá ~60 s) và không miễn theo IP phiên (mọi người cùng "IP"). Giảm thiệt hại DoS nhưng cũng yếu hơn chống đoán mật khẩu: chấp nhận cho dev; production in cảnh báo rõ khi khởi động (`src/server/startup-checks.ts`, gọi từ `instrumentation.ts`). Test: `tests/api/hardening.test.ts` (F2), `tests/unit/pure.test.ts`.

## Rủi ro F3: khoá từ xa người dùng ở IP mới
Backoff theo username áp cho mọi IP, trừ IP đã có phiên. Người lạ gửi 10 lần sai là chủ tài khoản ở IP lạ (đổi mạng, 4G, IPv6 xoay, VPN) bị chờ tới 60 s mỗi lần thử; kẻ tấn công duy trì nhịp ~1 lần/phút thì chủ tài khoản đó luôn gặp 429 khi không ở IP quen. Không khoá cứng nên không "khoá vĩnh viễn", nhưng gây phiền toái lâu dài.
**Giảm nhẹ đã làm**: cookie "thiết bị quen" (`__Host-portal_device` ở production, HttpOnly, SameSite=Lax, 180 ngày). Sau đăng nhập đúng, đặt `base64url(username).<16 byte ngẫu nhiên>.HMAC-SHA256(SESSION_SECRET)`. Thiết bị có cookie hợp lệ của đúng username được miễn backoff theo username (không miễn khoá cứng theo cặp/IP). Cookie không phải thông tin xác thực: lộ nó chỉ bỏ bước làm chậm, vẫn bị khoá cứng 5 lần/15 phút ở mỗi cặp (username, IP). Logout không xoá cookie này. `SESSION_SECRET` thiếu hoặc < 32 ký tự thì tính năng tắt (không cấp, không chấp nhận) và production in cảnh báo; đổi `SESSION_SECRET` vô hiệu mọi cookie này. Còn lại: chủ tài khoản ở thiết bị MỚI hoàn toàn (chưa có cookie) vẫn chờ tối đa 60 s lúc bị dò.

## Hệ quả
- Test hồi quy: `tests/api/hardening.test.ts` (200 request song song, backoff theo username, kind tách riêng, cookie thiết bị quen, TRUST_PROXY tắt, 429 của cổng argon2) và `tests/unit/pure.test.ts` (clientIp, IPv6 /64, cảnh báo khởi động).
- Bảng `login_attempt` vẫn do job dọn 24 giờ; lượt 429 không ghi hàng nên lũ request bị từ chối không phình bảng.

## Bổ sung 27/11/2026: IP riêng/NAT cũng coi là "chung"
Sau khi domain đi qua modem → router (proxy) → gateway, mọi truy cập đo được từ trong LAN (cả hairpin) hiện ra là `192.168.1.1`.
Chưa xác định được IP khách từ Internet có giữ nguyên qua modem hay bị SNAT (cần thử từ mạng ngoài, vd 4G). Để chắc chắn không bao giờ
thành khoá toàn cục, IP riêng/loopback/link-local (`isSharedIp` trong `src/server/lib/ip.ts`) được đối xử như `unknown`: bỏ khoá cứng
theo IP và theo cặp, chỉ còn backoff theo username (và cookie thiết bị quen). Đánh đổi: người ở sau NAT chung chỉ bị giới hạn bởi backoff
theo username (vẫn ≈ 1 lần/phút sau 10 lần sai).
