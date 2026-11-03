# 02 · Design System — "CSKV DS" v1.0.0

Hệ thiết kế cho **Bản đồ số Cảnh sát khu vực tỉnh Lâm Đồng** (app người dân + cổng cán bộ). Xây từ giao diện đang chạy (`platform/web/src/styles.css`, `product.css`) rồi chuẩn hoá thành token để mọi màn hình dùng chung.

| File | Nội dung |
|---|---|
| `tokens.json` | **Nguồn sự thật** — màu, chữ, khoảng cách, bo góc, đổ bóng, chuyển động, breakpoint, z-index |
| `tokens.css` | Biến CSS sinh tự động từ `tokens.json` (đưa thẳng vào code) |
| `ds.css` | Thư viện thành phần (CSS thuần, chỉ dùng biến trong `tokens.css`) |
| `foundations.html` | Xem trực quan: màu + tương phản, chữ, khoảng cách, bo góc, đổ bóng, biểu tượng |
| `components.html` | Xem trực quan: mọi thành phần × 6 trạng thái (mặc định · hover · focus · active · vô hiệu · lỗi) |

> Quy tắc vàng: **không có giá trị màu / cỡ chữ / khoảng cách nào nằm ngoài token**. Có script kiểm tra tự động (`05-handoff/lint-tokens.mjs`) — kết quả đính kèm trong `05-handoff/`.

---

## 1. Màu

Người dùng chính là người dân (nhiều độ tuổi, ngoài trời, ánh sáng mạnh) và cán bộ trực (đọc nhanh, trực đêm). Vì vậy: nền sáng, chữ đậm, **đỏ Công an** chỉ dành cho hành động chính; mọi trạng thái đều có **chữ + biểu tượng**, không chỉ màu.

### Thương hiệu & bản đồ
| Token | HEX | Dùng cho | Không dùng cho |
|---|---|---|---|
| `--color-primary` | `#D71935` | Nút chính, tab đang chọn, header, liên kết hành động | Nền diện rộng, cảnh báo lỗi (dùng `--color-danger`) |
| `--color-primary-deep` | `#8E1426` | Hover/active nút chính, header cổng cán bộ | Chữ nhỏ trên nền trắng |
| `--color-primary-soft` | `#FFF0F2` | Nền hàng đang chọn/ô biểu tượng | Nền cảnh báo lỗi |
| `--color-map` / `--color-info` | `#24566A` | Thông tin, ranh giới, biểu tượng thông tin | Nút hành động |
| `--color-map-deep` | `#193E4D` | Hover/tiêu đề trên nền thông tin | — |
| `--color-navy` | `#0B2447` | **Chỉ** màn chờ (splash) | Giao diện chính |
| `--color-gold-bright` | `#FFD65A` | Dòng phụ trên màn chờ | Nền sáng (tương phản kém) |

### Ngữ nghĩa
| Ngữ nghĩa | Chữ/biểu tượng | Nền nhạt | Khi nào |
|---|---|---|---|
| Thành công | `--color-success` `#16745C` | `--color-success-soft` `#E6F4EF` | Đã gửi, đã xử lý xong |
| Cảnh báo / cần chú ý | `--color-warning` `#946200` | `--color-warning-soft` `#FFF4D6` | Đang xử lý, mất mạng, GPS kém |
| Lỗi / nguy hiểm | `--color-danger-deep` `#8E1C2E` (chữ), `--color-danger` `#BA263B` (nền nút) | `--color-error-soft` `#FDECEF` | Lỗi nhập, SOS, thao tác không hoàn tác |
| Thông tin | `--color-info` `#24566A` | `--color-info-soft` `#E8F1F5` | Gợi ý, trạng thái tiếp nhận |

### Trung tính
`--color-ink #202B33` (chữ) · `--color-muted #596772` (chữ phụ) · `--color-subtle #8593A0` (**chỉ** viền/biểu tượng ≥ 3:1) · `--color-line #DCE2E6` (đường kẻ) · `--color-canvas #F5F7F8` (nền trang) · `--color-surface #FFFFFF` (thẻ, ô nhập) · `--color-disabled-bg/ink` · `--color-scrim` (lớp phủ tối).

### Quy tắc dùng màu
1. Mỗi màn hình tối đa **một** nút `primary` thấy được cùng lúc (trừ danh sách hành động tương đương).
2. SOS luôn dùng `--color-danger` + chữ trắng (6,1:1) và có chữ “SOS”.
3. Viền ô nhập/nút phụ dùng `--color-subtle` (3,1:1) — **không** dùng `--color-line` (1,3:1) cho viền điều khiển.
4. Không dùng `--color-subtle` làm chữ.
5. Trạng thái hồ sơ: xem bảng ánh xạ ở `components.html` (info → warn → ok → neutral).

Bảng tương phản đầy đủ (26 cặp; mọi cặp chữ / biểu tượng đạt WCAG 2.1 AA, riêng thành phần vô hiệu và đường kẻ trang trí được miễn): `foundations.html` và `05-handoff/contrast-report.json`.

---

## 2. Chữ

- **Be Vietnam Pro** (tiêu đề, tên thương hiệu, số lớn) — thiết kế cho tiếng Việt, dấu rõ.
- **Noto Sans** (nội dung, nhãn, nút) — đủ dấu tiếng Việt, đọc tốt cỡ nhỏ.
- Dự phòng: `"Segoe UI", sans-serif`. Tải font bằng Google Fonts (đã dùng trong `index.html`); bản Android đóng gói font cục bộ để chạy khi không có mạng.

| Lớp | Cỡ / dòng | Đậm | Họ chữ | Dùng cho |
|---|---|---|---|---|
| `.t-h1` | 24 / 1.35 | 600 | Heading | Tiêu đề trang |
| `.t-h2` | 20 / 1.35 | 600 | Heading | Tiêu đề mục, tờ trượt |
| `.t-h3` | 16 / 1.4 | 600 | Heading | Tiêu đề thẻ, hàng danh sách |
| `.t-body` | 16 / 1.5 | 400 | Body | Nội dung; **nội dung ô nhập luôn ≥ 16** (tránh iOS tự phóng to) |
| `.t-sm` | 14 / 1.45 | 400 | Body | Nhãn trường, nút, chữ phụ |
| `.t-xs` | 12 / 1.4 | 500 | Body | Chú thích, thời gian, nhãn trạng thái |
| `.t-2xs` | 11 / 1.2 | 600 | Body | Nhãn dưới biểu tượng (tab, nút header), huy hiệu — **cỡ tối thiểu** |

Quy tắc: không đặt cỡ chữ rời; không chữ nghiêng, không chữ in hoa toàn câu (trừ “SOS”); độ dài dòng ≤ 70 ký tự; ứng dụng Android giới hạn phóng chữ hệ thống ở 115 % nên mọi bố cục phải chịu được 115 %.

---

## 3. Khoảng cách, lưới, bo góc, đổ bóng

- **Lưới 4 px**: `space-1…7` = 4 · 8 · 12 · 16 · 24 · 32 · 48. (Alias trong code hiện tại: `--space-xs/sm/md/lg` = space-1/2/4/5.)
- **Lề trang** điện thoại 16 px (`space-4`), khoảng cách giữa khối 12–16 px, giữa mục lớn 24 px.
- **Lưới**: điện thoại 1 cột (lề 16); máy tính bảng dọc 2 cột; ≥ 1024 px: 2–3 vùng (danh bạ + bản đồ; hàng đợi + chi tiết + bản đồ). Nội dung trang tính năng tối đa 960 px.
- **Vùng chạm** tối thiểu 44 × 44 px (`--size-touch`), nút chính/SOS 52 px. Khoảng cách giữa hai vùng chạm ≥ 8 px.
- **Vùng an toàn**: header cộng `env(safe-area-inset-top)`, tab bar cộng `env(safe-area-inset-bottom)`.
- **Bo góc**: control 6 · md 10 · lg 12 (thẻ) · xl 16 (tờ trượt) · pill 999 (huy hiệu, công tắc).
- **Đổ bóng**: `card` (nhẹ, thẻ), `raised` (nút nổi trên bản đồ, toast), `sheet` (tờ trượt, ngăn kéo). Không dùng bóng để thể hiện trạng thái focus.

## 4. Biểu tượng
**Lucide** (ISC) nét 1.75: 20 px chuẩn · 16 px nhỏ · 28 px lớn. Biểu tượng đứng một mình bắt buộc có `aria-label`; trên header điện thoại luôn kèm nhãn chữ 11 px. Danh sách biểu tượng đang dùng: `foundations.html`.

## 5. Thành phần
Danh mục & trạng thái: `components.html`. Tóm tắt quy tắc:

| Thành phần | Quy tắc chính |
|---|---|
| Button | 4 kiểu: primary / secondary / ghost / danger. Cao ≥ 44 px, nhãn là **động từ** (“Gửi phản ánh”, không “OK”). Đang xử lý: vô hiệu + spinner, giữ nguyên bề rộng. |
| Input / Textarea / Select | Nhãn luôn hiển thị phía trên (không dùng placeholder làm nhãn). Lỗi: viền đỏ + biểu tượng + câu nói rõ cách sửa, đặt ngay dưới ô. Placeholder chỉ là ví dụ. |
| Checkbox / Radio / Switch | Vùng chạm cả hàng ≥ 44 px; switch có `role="switch"` + `aria-checked`. |
| Chip | Lọc/chọn một giá trị ngắn; không xuống dòng chữ (cuộn ngang nếu nhiều). |
| Status | Chữ + chấm màu; không chỉ màu. |
| Card / List | Thẻ viền `line` + bóng `card`; hàng danh sách cao ≥ 56 px, tiêu đề 14/600 + dòng phụ 12. |
| Table | Chỉ ở cổng cán bộ (≥ 1024); điện thoại dùng List. Số căn phải, `tabular-nums`. |
| Tabs / Tab bar | Tabs phân đoạn trong trang; Tab bar dưới 4 mục (Bản đồ · Danh bạ · Phản ánh · Tài khoản) chỉ ở điện thoại. |
| Sheet / Modal / Drawer | Có scrim, đóng bằng ✕ + nền + Esc, giữ/trả focus. Modal chỉ cho xác nhận không hoàn tác. |
| Toast | Tự tắt 9 s, `role="status"`, chạm để mở; không dùng cho lỗi cần hành động (dùng Alert). |
| Alert | 4 tone, có tiêu đề + 1 câu hướng dẫn; lỗi dùng `role="alert"`. |
| Empty / Loading / Error | Luôn có biểu tượng + tiêu đề + 1 câu + (nếu có) 1 nút hành động. Tải > 400 ms mới hiện spinner; danh sách dùng skeleton. |

## 6. Giọng điệu & chữ trên giao diện (tiếng Việt)
- Xưng hô trung tính, lịch sự, ngắn: “Bạn”, không “quý khách”. Cán bộ: “Nhận hồ sơ”, “Đã xử lý xong”.
- Thuật ngữ cố định: **phản ánh** (không “báo cáo/khiếu nại”), **hồ sơ** (mã PA-…), **Cảnh sát khu vực (CSKV)**, **địa bàn**, **SOS / cầu cứu khẩn cấp**, **cán bộ trực**.
- Lỗi: nói **chuyện gì xảy ra + làm gì tiếp** (“Chưa gửi được vì mất mạng. Nội dung đã được lưu nháp.”), không mã lỗi kỹ thuật.
- Trạng thái đọc được bởi người dân: “Trực ban đã tiếp nhận”, “Đang xử lý”, “Đã có kết quả” (không dùng `received/assigned…`).
- Số điện thoại: `0912 345 678`; thời gian: “08:12 hôm nay”, “31/10”; khoảng cách: “1,2 km” (dấu phẩy thập phân).

## 7. Chế độ & mở rộng
- Giao diện sáng duy nhất ở v1.0 (ngoài trời, ánh sáng mạnh). Chế độ tối: backlog (đã dành sẵn token ngữ nghĩa để đảo).
- `prefers-reduced-motion`: mọi chuyển động về 0 ms (đã có trong `tokens.css`).
- Chế độ **wireframe** trong tài liệu: thêm class `.wf` — cùng cấu trúc, bỏ màu/hình (bảng xám phác thảo là ngoại lệ có chủ đích, chỉ dùng cho tài liệu).
