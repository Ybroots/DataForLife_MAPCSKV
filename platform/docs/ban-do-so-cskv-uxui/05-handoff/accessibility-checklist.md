# Danh sách kiểm tra tiếp cận (WCAG 2.1 AA)

Áp dụng cho mọi màn hình trước khi nghiệm thu. Đánh dấu ☐ → ☑ trong biên bản kiểm thử.

## 1. Tương phản màu
Tính bằng công thức WCAG 2.1 từ `tokens.json` (xem `contrast-report.json`). Ngưỡng: chữ thường ≥ **4.5:1**, chữ lớn/biểu tượng/viền điều khiển ≥ **3:1**.

| Cặp màu (chữ / nền) | Dùng cho | Tỉ lệ | Yêu cầu | Kết quả |
|---|---|---|---|---|
| `ink` / `surface` | Chữ chính trên thẻ | 14.44:1 | ≥ 4.5:1 | ✓ Đạt |
| `ink` / `canvas` | Chữ chính trên nền trang | 13.43:1 | ≥ 4.5:1 | ✓ Đạt |
| `muted` / `surface` | Chữ phụ trên thẻ | 5.82:1 | ≥ 4.5:1 | ✓ Đạt |
| `muted` / `canvas` | Chữ phụ trên nền trang | 5.42:1 | ≥ 4.5:1 | ✓ Đạt |
| `on-primary` / `primary` | Chữ nút chính / header | 5.15:1 | ≥ 4.5:1 | ✓ Đạt |
| `on-primary` / `primary-deep` | Nút chính khi nhấn | 9.22:1 | ≥ 4.5:1 | ✓ Đạt |
| `primary` / `surface` | Liên kết / nút viền đỏ trên thẻ | 5.15:1 | ≥ 4.5:1 | ✓ Đạt |
| `primary` / `primary-soft` | Chữ đỏ trên nền nhấn nhẹ | 4.66:1 | ≥ 4.5:1 | ✓ Đạt |
| `on-primary` / `error` | Chữ nút SOS / nguy hiểm | 6.13:1 | ≥ 4.5:1 | ✓ Đạt |
| `error-deep` / `error-soft` | Thông báo lỗi | 7.82:1 | ≥ 4.5:1 | ✓ Đạt |
| `error-deep` / `surface` | Lỗi dưới ô nhập | 8.91:1 | ≥ 4.5:1 | ✓ Đạt |
| `success` / `surface` | Chữ thành công trên thẻ | 5.7:1 | ≥ 4.5:1 | ✓ Đạt |
| `success` / `success-soft` | Thông báo thành công | 5.03:1 | ≥ 4.5:1 | ✓ Đạt |
| `warning` / `surface` | Chữ cảnh báo trên thẻ | 5.24:1 | ≥ 4.5:1 | ✓ Đạt |
| `warning` / `warning-soft` | Thông báo cảnh báo | 4.78:1 | ≥ 4.5:1 | ✓ Đạt |
| `info` / `surface` | Chữ thông tin trên thẻ | 8.03:1 | ≥ 4.5:1 | ✓ Đạt |
| `info` / `info-soft` | Thông báo thông tin | 7.01:1 | ≥ 4.5:1 | ✓ Đạt |
| `muted` / `primary-soft` | Chữ phụ trên nền nhấn | 5.27:1 | ≥ 4.5:1 | ✓ Đạt |
| `muted` / `info-soft` | Chữ phụ trên nền thông tin | 5.08:1 | ≥ 4.5:1 | ✓ Đạt |
| `disabled-ink` / `disabled-bg` | Thành phần vô hiệu (WCAG miễn, vẫn đọc được) | 3.99:1 | miễn | ✓ Đạt |
| `on-primary` / `navy` | Tên app trên màn chờ | 15.47:1 | ≥ 4.5:1 | ✓ Đạt |
| `gold` / `navy` | Dòng phụ trên màn chờ | 11.06:1 | ≥ 4.5:1 | ✓ Đạt |
| `subtle` / `surface` | Biểu tượng/viền phụ trên thẻ | 3.14:1 | ≥ 3:1 | ✓ Đạt |
| `line` / `surface` | Đường kẻ trang trí (không bắt buộc) | 1.31:1 | miễn | ✓ Đạt |
| `primary` / `surface` | Viền/biểu tượng đỏ | 5.15:1 | ≥ 3:1 | ✓ Đạt |
| `map` / `surface` | Biểu tượng thông tin | 8.03:1 | ≥ 3:1 | ✓ Đạt |

**Ghi chú**
- *Thành phần vô hiệu hoá* được WCAG miễn trừ, nhưng thiết kế vẫn giữ ~4:1 để người lớn tuổi đọc được.
- `line` (1.31:1) **chỉ dùng làm đường kẻ trang trí** giữa các mục. Viền **ô nhập, ô chọn, checkbox, radio, nút viền** phải dùng `subtle` (3.14:1) hoặc đậm hơn để đạt 3:1 (WCAG 1.4.11).
- Không truyền đạt thông tin chỉ bằng màu: mọi trạng thái có chữ + biểu tượng.

## 2. Vùng chạm & khoảng cách
- ☐ Mọi điều khiển chạm được ≥ **44 × 44 px** (`--size-touch`); nút chính/SOS ≥ 52 px (`--size-touch-lg`).
- ☐ Khoảng cách giữa hai vùng chạm liền kề ≥ 8 px (`--space-2`).
- ☐ Nhãn bên trong nút header: biểu tượng + chữ trong cùng một vùng chạm.

## 3. Chữ & phóng chữ
- ☐ Nội dung chính ≥ 16 px (`--fs-body`); phụ ≥ 14 px (`--fs-sm`); không dùng chữ < 11 px.
- ☐ Màn hình không vỡ ở cỡ chữ hệ thống 130 % trên trình duyệt; 115 % trong app Android.
- ☐ Chiều cao dòng ≥ 1.4 cho đoạn văn; không căn đều hai bên (justify).
- ☐ Câu ngắn, thuật ngữ nghiệp vụ có giải thích ở lần đầu (“Địa bàn”, “Hồ sơ”).

## 4. Nhãn & cấu trúc (đọc màn hình TalkBack / VoiceOver)
- ☐ Mỗi ô nhập có `<label>` hiển thị (không chỉ placeholder); `aria-describedby` cho gợi ý và lỗi.
- ☐ Nút chỉ có biểu tượng phải có `aria-label` tiếng Việt đầy đủ (“Đóng”, “Xoá nội dung tìm kiếm”, “Bỏ chọn địa bàn, xem toàn tỉnh”).
- ☐ Một `h1` mỗi màn; tiêu đề phân cấp h1 → h2 → h3, không nhảy cấp.
- ☐ Vùng chính dùng landmark: `header`, `nav`, `main`; tab bar có `role="tablist"` hoặc `nav` + `aria-current="page"`.
- ☐ Danh sách là `ul/li` (hoặc `role="list"`); bảng có `th scope`.
- ☐ Trạng thái hồ sơ có chữ (“Đang xử lý”), không chỉ chấm màu.
- ☐ Toast `role="status"`/`aria-live="polite"`; lỗi `role="alert"`.
- ☐ Báo động O03: `role="alertdialog"`, tiêu đề + mô tả, focus vào nút “Nhận SOS ngay”.
- ☐ Ảnh/biểu tượng trang trí `aria-hidden="true"`; ảnh có nội dung có `alt`.
- ☐ `lang="vi"` ở thẻ `html`.

## 5. Bàn phím & focus
- ☐ Toàn bộ chức năng dùng được bằng bàn phím (cổng cán bộ trên máy tính).
- ☐ Vòng focus nhìn thấy rõ: 2 px `--color-primary`, cách 3 px, tương phản ≥ 3:1 với nền kề.
- ☐ Bẫy focus trong tờ trượt/ngăn kéo/hộp thoại; Esc đóng; trả focus về nút mở.
- ☐ Không có “bẫy” focus ở bản đồ: có nút bỏ qua bản đồ / tab ra khỏi bản đồ.

## 6. Chuyển động & cảm giác
- ☐ Tôn trọng `prefers-reduced-motion` (token chuyển động về 0 ms).
- ☐ Không có nội dung nhấp nháy > 3 lần/giây (ghim SOS 1 Hz — đạt).
- ☐ Còi báo động có nút tắt tiếng; trạng thái còi hiển thị bằng chữ (“Còi bật/Còi tắt”).

## 7. Biểu mẫu & lỗi
- ☐ Lỗi nêu **chuyện gì** + **cách sửa** (“Số điện thoại cần 10 chữ số”), nằm ngay dưới ô.
- ☐ Giữ nguyên dữ liệu đã nhập khi lỗi; có tự động điền khi hợp lý (vị trí GPS).
- ☐ Không giới hạn thời gian thao tác; phiên cán bộ hết hạn có cảnh báo trước.
- ☐ Mật khẩu: nút hiện/ẩn có nhãn; cho phép dán.

## 8. Kiểm thử bắt buộc trước nghiệm thu
| Kiểm thử | Công cụ | Đạt khi |
|---|---|---|
| Tương phản | `contrast-report.json` + Accessibility Scanner (Android) | 0 lỗi |
| Đọc màn hình | TalkBack (Android), NVDA (Windows) | Luồng F1, F2, F4, F5 hoàn thành chỉ bằng âm thanh |
| Cỡ chữ | Cài đặt Android › Cỡ chữ lớn nhất | Không cắt/đè chữ ở C03, C06, C08 |
| Bàn phím | Chrome + Tab/Shift+Tab/Enter/Esc | Luồng F5–F7 hoàn thành không cần chuột |
| Tắt chuyển động | “Xoá hoạt ảnh” (Android) / `prefers-reduced-motion` | Không còn hiệu ứng trượt, nhấp nháy |
| Thiết bị thật | 1 máy Android 8, 1 máy Android 14 | Header không tràn chữ; SOS gửi được |
