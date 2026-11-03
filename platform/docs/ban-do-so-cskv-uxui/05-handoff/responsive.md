# Đáp ứng nhiều kích thước (Responsive)

## 1. Breakpoint
| Token | Giá trị | Nhóm thiết bị | Thay đổi chính |
|---|---|---|---|
| `xs` | 320 px | Điện thoại nhỏ nhất cần hỗ trợ | Ẩn dòng phụ + nhãn nút header ≤ 340 px (giữ biểu tượng, `aria-label` đầy đủ); nút 44 px |
| `sm` | 380 px | Điện thoại phổ biến | Nhãn nút header ở cỡ chuẩn; dòng phụ rút gọn có “…” |
| `md` | 640 px | Điện thoại lớn / tablet dọc | Nội dung giới hạn rộng 640 px, canh giữa; tờ trượt thành hộp thoại giữa màn |
| `lg` | 1024 px | **Ngưỡng đổi bố cục** | Dưới: 1 cột + tab dưới; từ đây: 2 cột + header đầy đủ |
| `xl` | 1280 px | Máy tính | Cổng cán bộ 3 vùng: danh sách · chi tiết · bản đồ |

Viết CSS theo hướng **mobile-first** (`min-width`), ngoại trừ các quy tắc “thu gọn” cho ≤ 380 / ≤ 340 px.

## 2. Bố cục từng nhóm màn hình
| Màn | < 640 | 640–1023 | ≥ 1024 |
|---|---|---|---|
| C03 Bản đồ | Bản đồ full-bleed, ô tìm kiếm nổi, SOS nổi góc phải dưới | Như trái, thẻ địa bàn rộng ≤ 480 px | Cột bên trái 360 px (tìm kiếm, danh sách) + bản đồ; **ô chọn địa bàn & nút “Toàn tỉnh” hiện** (≥ 1024) |
| C04 Danh bạ | Danh sách 1 cột; chi tiết = tờ trượt | Danh sách + chi tiết cạnh nhau | Như tablet |
| C06 Phản ánh | 1 cột, nút Gửi dính đáy | Căn giữa 640 px | Căn giữa 640 px |
| C07 Theo dõi | Danh sách → chi tiết (đẩy màn) | 2 cột | 2 cột |
| O02 Hàng đợi | 1 cột; điều hướng thành **tab dưới** (Hàng đợi · Bản đồ · Nghiệp vụ) | 1 cột | 3 vùng: danh sách (360) · chi tiết · bản đồ |
| O03 Báo động | Toàn màn hình | Toàn màn hình | Toàn màn hình |
| O06 Báo cáo | Bảng cuộn ngang trong thẻ (cột đầu cố định) | Bảng đầy đủ | Bảng đầy đủ + KPI 4 cột |

## 3. Header người dân (điện thoại)
- Bố cục: **[Huy hiệu + tên app / dòng phụ] … [Trợ lý] [Thông báo] [Tính năng]**; cao 56 px (token `--size-topbar`) cộng vùng an toàn trên.
- 3 nút: cột dọc biểu tượng + nhãn chữ; mỗi nút rộng tối thiểu 50 px, cao ≥ 44 px; **không** co dãn (`flex: 0 0 auto`), phần tên app co lại và cắt bằng “…” → **không bao giờ tràn chữ**.
- Huy hiệu đếm thông báo nằm góc trên phải biểu tượng chuông, tối đa “9+”.
- ≤ 340 px: ẩn dòng phụ và nhãn nút; giữ `aria-label`.
- Thử nghiệm bắt buộc: 320 / 360 / 390 / 412 px × cỡ chữ hệ thống 100 % / 115 % / 130 %.

## 4. Phóng chữ hệ thống (Android “Cỡ chữ”)
- Ứng dụng WebView giới hạn `textZoom` tối đa **115 %** để header/tab không vỡ; nội dung chính vẫn đọc được vì chữ gốc 16 px.
- Mọi khối chứa chữ dùng `min-height` (không `height` cố định) và cho phép xuống dòng, trừ nhãn nút/tab (một dòng, cắt “…”).
- Nhãn tab dưới đáy: tối đa 1 dòng, 11–12 px (`--fs-2xs`/`--fs-xs`); luôn kèm biểu tượng.

## 5. Vùng an toàn (safe area)
- Dùng `env(safe-area-inset-*)` cho thanh trên, tab dưới, nút nổi và tờ trượt.
- Nút SOS cách đáy tối thiểu `tab bar + 16 px`; không đè lên tab.

## 6. Hướng màn hình
- Người dân: ưu tiên dọc; ngang vẫn dùng được (bản đồ full-bleed, biểu mẫu cuộn). SOS luôn thấy được ở cả hai hướng.
- Cán bộ: tối ưu ngang ≥ 1024 px; điện thoại dùng bố cục 1 cột.

## 7. Ảnh & dữ liệu nặng
- Ảnh đính kèm tự nén ≤ ~1 MB (cạnh dài ≤ 1600 px) trước khi gửi; hiển thị thumbnail 72 px.
- Bản đồ: tải theo vùng; khi mất mạng hiện lớp nền đơn sắc và địa bàn đã tải.
