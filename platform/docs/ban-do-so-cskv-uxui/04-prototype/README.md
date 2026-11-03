# 04 · Prototype tương tác

Mở **`index.html`** bằng trình duyệt (Chrome, Edge, Safari; không cần máy chủ, không cần mạng). Hai luồng chính, chọn ở thanh trên cùng:

| Luồng | Thiết bị | Kịch bản (bấm trực tiếp vào màn hình) |
|---|---|---|
| **Người dân** | Điện thoại | Chào mừng → bản đồ → chạm địa bàn → danh bạ → Phản ánh (bị chặn → đăng nhập) → báo lỗi khi bỏ trống → nói/gõ → gửi → theo dõi hồ sơ → **SOS giữ 3 giây** → cán bộ nhận |
| **Cán bộ** | Máy tính | Đăng nhập → hàng đợi → Nhận hồ sơ → Bắt đầu xử lý → ghi kết quả (báo lỗi < 20 ký tự) → đóng hồ sơ (xác nhận 2 lần) → **báo động SOS** → Phát cảnh báo → Lưu trữ & báo cáo → xuất PDF |

Cột bên trái có 3 khối:
1. **Kịch bản thử** — các bước, tự đánh dấu ✓ khi bạn làm xong.
2. **Mô phỏng sự kiện** — việc xảy ra bên ngoài màn hình: cán bộ nhận SOS, hồ sơ có kết quả, mất/có mạng, lỗi tải, SOS mới tới, SOS quá 2 phút.
3. **Trạng thái của màn này** — nhảy tới bất kỳ trạng thái nào (rỗng, đang tải, lỗi, thành công…) để duyệt nhanh.

URL: `index.html#nguoi-dan` · `index.html#can-bo`.

## Cách hoạt động (cho dev)
- Prototype **dùng lại 100 % HTML** của `03-screens/assets/ui-lib.js` + `02-design-system/ds.css` — nên khớp tuyệt đối với bản thiết kế và design token.
- Hành vi khai báo bằng thuộc tính trong HTML màn hình: `data-go="c04"` (đi tới màn), `data-set="detail"` (đặt trạng thái), `data-act="take"` (hành động cán bộ), `data-login` (đăng nhập). `proto.js` đọc các thuộc tính này; phần logic riêng (kiểm tra biểu mẫu, giữ SOS 3 giây, chặn đăng nhập…) cũng nằm ở `proto.js`.
- Không gọi mạng, không lưu dữ liệu; tải lại trang = làm lại từ đầu.

## Giới hạn có chủ ý (đây là prototype, không phải app)
- Dữ liệu cố định: chi tiết hồ sơ ở hàng đợi luôn là PA-241102-0042; bản đồ là hình minh hoạ.
- Gọi điện / chỉ đường / chọn ảnh chỉ hiện thông báo “minh hoạ”.
- Hai luồng độc lập: SOS gửi ở luồng người dân không tự hiện ở luồng cán bộ — dùng nút “SOS mới tới”.
- Âm thanh còi và rung chỉ mô tả trong `05-handoff/interaction-spec.md` (prototype có rung `navigator.vibrate` khi SOS gửi, nếu thiết bị hỗ trợ).
