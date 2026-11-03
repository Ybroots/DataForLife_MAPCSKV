# Đối chiếu token ⇄ mã nguồn hiện có & các chỗ cần sửa

Nguồn đối chiếu: `platform/web/src/styles.css` (khối `:root`) và `product.css`, tại thời điểm 2026-11-02.

## 1. Biến đang có trong code → token chuẩn
| Biến trong code | Giá trị | Token chuẩn | Hành động |
|---|---|---|---|
| `--color-primary` | `#D71935` | `--color-primary` | Giữ nguyên |
| `--color-primary-deep` | `#8E1426` | `--color-primary-deep` | Giữ nguyên |
| `--color-primary-soft` | `#FFF0F2` | `--color-primary-soft` | Giữ nguyên |
| `--color-danger` / `-deep` | `#BA263B` / `#8E1C2E` | `--color-danger` / `--color-danger-deep` | Giữ nguyên |
| `--color-map` / `-deep` | `#24566A` / `#193E4D` | `--color-map` / `--color-map-deep` | Giữ nguyên |
| `--color-ink`, `--color-muted` | `#202B33`, `#596772` | cùng tên | Giữ nguyên |
| `--color-surface`, `--color-canvas`, `--color-line` | `#FFF`, `#F5F7F8`, `#DCE2E6` | cùng tên | Giữ nguyên |
| `--color-success` | `#16745C` | `--color-success` | Giữ nguyên |
| `--color-gold` | `#946200` | `--color-warning` | **Đổi tên** (là màu cảnh báo, không phải “vàng thương hiệu”) |
| `--space-xs/sm/md/lg` | 4 / 8 / 16 / 24 px | `--space-1/2/4/5` | Đổi tên; thêm `--space-3` (12), `--space-6` (32), `--space-7` (48) |
| `--radius-control` | 6 px | `--radius-control` | Giữ nguyên; thêm `--radius-md/lg/xl/pill` |
| `--shadow-card`, `--shadow-raised` | — | cùng tên | Giữ nguyên; thêm `--shadow-sheet` |
| *(chưa có)* | — | `--color-*-soft`, `--color-subtle`, `--color-disabled-*`, `--color-scrim`, `--color-navy`, `--color-gold-bright` | **Thêm mới** (dán từ `tokens.css`) |
| *(chưa có)* | — | `--fs-*`, `--fw-*`, `--font-heading/body/mono` | **Thêm mới** |
| *(chưa có)* | — | `--motion-*`, `--z-*`, `--size-*` | **Thêm mới** |
| `--topbar-height: 64px` | 64 px | `--size-topbar` = 56 px (+ safe area) | Rà lại: header thật cao 64 px vì chứa nhãn chữ; **cập nhật token thành 64 px** nếu giữ thiết kế hiện tại (đề xuất) |

## 2. Quy ước đặt tên
- Màu: `--color-<vai-trò>[-<biến-thể>]` (`primary`, `primary-deep`, `primary-soft`, `on-primary`). **Đặt theo vai trò, không theo màu** (không `--red-500`).
- Chữ: `--fs-<cấp>` (`h1 h2 h3 body sm xs 2xs`) + `-lh`; lớp tiện ích `.t-<cấp>`.
- Khoảng cách: thang 4 px: `--space-1…7` = 4, 8, 12, 16, 24, 32, 48.
- Token mới thêm *chưa có trong code hiện tại* có cờ `"inCode": false` trong `tokens.json`.

## 3. Số liệu thực tế — mã nguồn hiện lệch bao nhiêu
Chạy `node lint-tokens.mjs <platform/web/src>` ngày 2026-11-02:

| Loại giá trị rời | Số lần |
|---|---|
| Mã màu HEX trong CSS | 830 |
| `rgb()/rgba()` | 193 |
| `font-size` không dùng `--fs-*` | 591 (trong đó ~300 chỗ `12px`) |
| `font-family` không dùng `--font-*` | 49 |
| **Tổng** | **1663** |

→ Bộ UX/UI này **nhất quán 100 % với design system** (lint = 0), còn **mã nguồn sản phẩm chưa tuân token**. Đây là việc “chuyển đổi” cần lên kế hoạch, không phải lỗi thiết kế.

### Lộ trình chuyển đổi đề xuất (không làm vỡ giao diện đang chạy)
| Bước | Việc | Rủi ro |
|---|---|---|
| 1 | Dán `tokens.css` vào đầu `styles.css`; giữ các biến cũ làm *alias* (`--color-gold: var(--color-warning)`) | Rất thấp |
| 2 | Thay `font-size` bằng `--fs-*` theo bảng: 12→`xs`, 13→`xs`/`sm`, 14→`sm`, 15–16→`body`, 18–20→`h2`/`h3`, 22–24→`h1`; **chụp ảnh trước/sau** | Thấp–vừa (chữ lớn hơn 1–2 px một số chỗ) |
| 3 | Thay HEX/rgba bằng `var(--color-*)` (có thể tự động bằng script tra bảng HEX→token) | Thấp |
| 4 | Thêm `lint-tokens.mjs` vào CI với ngưỡng giảm dần (vd cho phép ≤ 300 rồi → 0) | Không |
| 5 | Chuyển thành phần theo thư viện `02-design-system/ds.css` từng màn (ưu tiên C03, C06, C08, O02) | Vừa |

## 4. Danh sách chỗ code lệch so với thiết kế (cần dev xử lý)
| # | Hạng mục | Hiện trạng trong code | Thiết kế yêu cầu | Mức |
|---|---|---|---|---|
| G1 | Viền ô nhập / chọn / nút viền | `var(--color-line)` (1.31:1) | `var(--color-subtle)` (3.14:1) — WCAG 1.4.11 | Cao |
| G2 | Vòng focus | `3px solid var(--color-gold)`; vài chỗ `rgba(…,.28–.42)` (tương phản thấp) | 2 px `--color-primary`, cách 3 px; trên nền đỏ: `--color-on-primary` | Cao |
| G3 | Cỡ chữ nhỏ | có `9.5px`, `10px`, nhiều `11–12px` cho nội dung | Tối thiểu 11 px (`--fs-2xs`) chỉ cho nhãn tab/huy hiệu; nội dung ≥ 14 px | Vừa |
| G4 | Font | Be Vietnam Pro / Noto Sans nạp từ Google Fonts | **Đóng gói font trong app** (offline, không nhấp nháy chữ) | Vừa |
| G5 | Nhãn nút header | `::after` giả phần tử, không co theo phóng chữ | Dùng phần tử `<span>` thật để đọc màn hình + phóng chữ nhất quán | Thấp |
| G6 | Giảm chuyển động | Có `prefers-reduced-motion` ở 2 nơi nhưng không phủ ghim SOS nhấp nháy | Phủ mọi animation lặp | Vừa |
| G7 | Màu chế độ phác thảo / cảnh báo nền cố định (`#fff6df`, `#e8f7f3`, …) | HEX rời | `--color-warning-soft`, `--color-success-soft` | Thấp |
