# Header chuyển tiếp dùng chung cho mọi location proxy. Phải include trong TỪNG location (nginx không kế thừa
# proxy_set_header khi location tự đặt thêm header).
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Host $http_host;
# Cổng gateway chỉ tới được qua tunnel https (cookie portal luôn Secure): ghi đè cứng, không tin header client.
proxy_set_header X-Forwarded-Proto https;
proxy_set_header Forwarded "";
proxy_set_header X-Middleware-Subrequest "";
# GHI ĐÈ, không append: header client gửi (X-Forwarded-For, X-Client-IP, X-Real-IP) không bao giờ tới upstream.
# $remote_addr đã qua real_ip (CF-Connecting-IP khi đứng sau Cloudflare tunnel).
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Client-IP $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header CF-Connecting-IP "";
