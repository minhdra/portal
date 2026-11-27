# Wireframe portal (wave 1)

Mở `index.html` để so sánh. Mỗi phương án là một file HTML tĩnh (CSS nội tuyến, không CDN, JS chỉ cho nút Sáng/Tối), có đủ: trang chủ, trạng thái trống (chưa có item, chưa có topic, tìm không ra), quản trị topic + form thêm item, xem tài liệu (PDF/DOCX/XLSX đổi bằng bấm tên tệp, không cần JS), soạn note Markdown (soạn + xem trước + lịch sử), đăng nhập và đổi mật khẩu lần đầu. Dữ liệu mẫu trung tính. Đáp ứng điện thoại, sáng/tối.

Các nút chưa nối chức năng: đây là wireframe, chỉ để chọn bố cục.

## A. Sidebar topic + lưới thẻ
- Ưu: quen thuộc, dễ hiểu ngay; thẻ to dễ bấm; thấy cây topic lồng nhau.
- Nhược: chỉ thấy một topic mỗi lúc; lưới thẻ tốn chỗ (điện thoại khoảng 3 thẻ mỗi màn); muốn mở tool hay dùng vẫn phải chọn topic trước.

## B. Tab topic ngang + danh sách dày
- Ưu: nhiều mục nhất trên màn điện thoại; quét mắt nhanh nhờ cột loại/đích/thẻ; công dựng thấp nhất; quản trị đơn giản.
- Nhược: nhiều topic thì tab cuộn ngang; trông "kỹ thuật", ít điểm nhấn; không có chỗ riêng cho mục hay dùng (vẫn 2 bước: tab rồi dòng).

## C. Bảng điều khiển (ghim + gần đây + topic)
- Ưu: Ghim cho đúng "bấm một lần là sang tool"; ô tìm lớn ngay đầu trang; thấy tổng quan nhiều topic một lượt.
- Nhược: công dựng cao nhất (cần ghim, ghi nhận gần đây); nhiều khối nên trên điện thoại cuộn dài; quản trị kiểu cột kéo thả phức tạp hơn.

## Khuyến nghị: C, kèm trang topic dạng danh sách của B
Mục tiêu của chủ dự án là tìm nhanh và bấm một lần. Chỉ C có chỗ cho việc đó (Ghim và Gần đây đưa tool hay dùng lên mặt trang chủ, không phải chọn topic trước), còn A và B đều tối thiểu 2 bước. Khi bấm "Xem tất cả" ở một topic, dùng bố cục danh sách dày của B vì quét nhanh và hợp điện thoại. Nếu cần ra bản đầu sớm, B là phương án rẻ nhất, thêm Ghim sau.

Ghi chú xây dựng: màu nhấn chữ/nút dùng #0f766e (sáng) và #2dd4bf (tối) để đạt tương phản AA; #0d9488 gốc của logo chỉ ~3,7:1 trên nền trắng nên không dùng cho chữ.
