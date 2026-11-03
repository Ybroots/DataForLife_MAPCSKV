# Đặc tả tương tác & chuyển động

Mọi thời lượng/easing lấy từ token `--motion-*`. Khi hệ điều hành bật “giảm chuyển động” (`prefers-reduced-motion`) → các thời lượng về `0ms`; chỉ giữ thay đổi trạng thái tức thời (không trượt, không nhấp nháy).

## 1. Token chuyển động
| Token | Giá trị | Dùng cho |
|---|---|---|
| `--motion-fast` | 150 ms | Đổi màu nền/viền/chữ khi hover, nhấn, focus |
| `--motion-base` | 180 ms | Mở/đóng chi tiết, đổi tab, hiện/ẩn thành phần nhỏ |
| `--motion-slow` | 280 ms | Tờ trượt (sheet), ngăn kéo (drawer), toast vào/ra |
| `--motion-ease` | cubic-bezier(0.2, 0, 0, 1) | Mọi chuyển động (giảm tốc nhanh, cảm giác nhạy) |

## 2. Đặc tả theo thành phần
| Thành phần | Sự kiện | Hiệu ứng | Thời lượng | Ghi chú |
|---|---|---|---|---|
| Button | hover / nhấn | Đổi nền + viền sang sắc đậm hơn (primary → `primary-deep`) | fast | Nhấn = có phản hồi ≤ 100 ms; không scale |
| Button | bấm gửi | Vô hiệu + spinner thay nhãn, giữ độ rộng | tức thời | Chặn bấm đúp; nhãn “Đang gửi…” cho trình đọc màn hình |
| Input | focus | Viền đổi `ink`, viền focus 2 px `primary` cách 3 px | fast | Không dùng bóng đổ để thể hiện focus |
| Tờ trượt (Sheet) | mở | Trượt từ đáy lên + nền tối `--color-scrim` mờ dần | slow | Đóng: kéo xuống / bấm nền / ✕ / phím Esc |
| Ngăn kéo (Drawer – Menu Tính năng) | mở | Trượt từ phải | slow | Bẫy focus bên trong; đóng trả focus về nút mở |
| Toast | hiện | Trượt lên 8 px + mờ vào; tự tắt sau **5 s** (lỗi: 8 s, có nút ✕) | slow | Vùng `aria-live="polite"`; lỗi dùng `assertive` |
| Tab | đổi | Thanh chỉ báo trượt; nội dung đổi tức thời | base | Giữ vị trí cuộn từng tab |
| Skeleton | đang tải | Mờ sáng ↔ tối nhẹ 1.2 s lặp | — | Tắt hoàn toàn khi giảm chuyển động |
| Spinner | đang xử lý | Quay 0.8 s/vòng | — | Thay bằng chữ “Đang xử lý…” khi giảm chuyển động |
| Ghim SOS trên bản đồ | có SOS | Nhấp nháy 1 Hz | — | Giảm chuyển động → đổi sang viền dày, không nhấp nháy |
| Báo động O03 | SOS mới | Phủ toàn màn hình **không có hoạt ảnh vào** (phải thấy ngay) | 0 | Còi lặp; tắt tiếng 30 s ≠ đóng báo động |
| Bản đồ | chọn địa bàn | Bay tới (fly-to) | 600 ms | Giảm chuyển động → nhảy thẳng |

## 3. SOS giữ 3 giây (C08)
| Mốc | Hành vi |
|---|---|
| 0 s — chạm giữ | Bắt đầu vòng tiến độ quanh nút; rung nhẹ (10 ms) |
| 0–3 s | Vòng đầy dần theo thời gian thực; chữ “Giữ nút 3 giây để gửi SOS” |
| Thả tay sớm | Vòng về 0, **không gửi gì**, hiện dòng “Đã huỷ – chưa gửi gì” |
| 3 s | Rung 2 nhịp (50–100–50 ms) → gửi; nút chuyển “Đang gửi…” |
| Gửi thành công | Màn “Đã gửi – chờ cán bộ nhận” + nút **Gọi trực tiếp 113** |
| Cán bộ nhận | Thông báo đẩy + màn “Cán bộ … đã nhận” + nút gọi |
| Lỗi mạng | “Chưa gửi được” + nút **Gửi lại** + **Gọi 113** (không để người dùng cụt đường) |
> Giá trị “3 giây” là đề xuất — cần xác nhận với đơn vị (xem README gốc, mục xác nhận).

## 4. Quản lý focus & bàn phím
- Mở tờ trượt/ngăn kéo/hộp thoại: focus chuyển vào phần tử đầu tiên có thể thao tác (hoặc tiêu đề); **bẫy Tab** bên trong; Esc đóng; đóng xong trả focus về phần tử đã mở.
- Chuyển màn: focus về tiêu đề `h1` của màn mới (`tabindex="-1"`), trình đọc màn hình đọc tên màn.
- Lỗi biểu mẫu: focus nhảy vào ô lỗi đầu tiên; mỗi lỗi nằm dưới ô, gắn `aria-describedby`; có tóm tắt lỗi ở đầu biểu mẫu khi > 1 lỗi.
- Thứ tự Tab = thứ tự đọc trực quan (trái→phải, trên→dưới). Không dùng `tabindex` dương.
- Vòng focus: 2 px `--color-primary`, cách 3 px; trên nền đỏ dùng `--color-on-primary`.

## 5. Cử chỉ (điện thoại)
| Cử chỉ | Tác dụng | Có cách thay thế bằng nút? |
|---|---|---|
| Chạm | Chọn / mở | — |
| Vuốt từ cạnh trái (hệ điều hành) | Quay lại | Có: nút “Quay lại” |
| Kéo xuống trên tờ trượt | Đóng tờ trượt | Có: nút ✕ |
| Chụm / hai ngón trên bản đồ | Phóng to/thu nhỏ | Có: nút +/− |
| Giữ 3 giây | Gửi SOS | Không (cố ý, chống bấm nhầm) — nhưng luôn có **Gọi 113** |
> Không có thao tác nào *chỉ* thực hiện được bằng cử chỉ phức tạp (trừ SOS giữ, có lối thoát gọi 113).

## 6. Phản hồi khác
| Tình huống | Phản hồi |
|---|---|
| Gửi thành công | Toast xanh + biểu tượng ✓ + chữ; đồng thời cập nhật màn |
| Lỗi mạng khi gửi | Banner vàng cố định đến khi gửi lại được; dữ liệu lưu nháp |
| Mất mạng | Banner “Đang mất kết nối” ở đầu màn; tra cứu dữ liệu đã tải vẫn dùng được |
| Phiên cán bộ hết hạn | Chuyển O01 kèm thông báo; sau đăng nhập quay lại đúng hồ sơ đang mở |
| Thông báo đẩy | Nội dung chung (không lộ chi tiết vụ việc trên màn khoá); chạm → mở đúng hồ sơ |
