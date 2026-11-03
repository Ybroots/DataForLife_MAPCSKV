# 05 · Bàn giao cho đội phát triển

| Tệp | Dùng để |
|---|---|
| [`tokens.json`](tokens.json) | Nguồn sự thật của design token (màu, chữ, khoảng cách, kích thước, bo góc, đổ bóng, chuyển động, breakpoint, z-index). Dùng cho Style Dictionary / Figma Tokens / Android resources. |
| [`tokens.css`](tokens.css) | Biến CSS sinh từ `tokens.json` — nhúng thẳng vào web/Capacitor. Không sửa tay. |
| [`token-map.md`](token-map.md) | Bảng đối chiếu token ⇄ biến hiện có trong `platform/web/src/styles.css` và **danh sách chỗ code đang lệch** cần sửa. |
| [`interaction-spec.md`](interaction-spec.md) | Đặc tả chuyển động, thời lượng, easing, cử chỉ, quản lý focus, rung/còi. |
| [`responsive.md`](responsive.md) | Breakpoint, bố cục từng mốc, hành vi header, phóng chữ hệ thống 115 %. |
| [`accessibility-checklist.md`](accessibility-checklist.md) | Danh sách kiểm tra tiếp cận (tương phản, vùng chạm, nhãn, focus, đọc màn hình) + bảng kết quả tương phản. |
| [`contrast-report.json`](contrast-report.json) | Kết quả tính tương phản WCAG 2.1 cho 26 cặp màu thực dùng (gồm 2 cặp miễn trừ) (máy đọc được). |
| [`lint-tokens.mjs`](lint-tokens.mjs) | Script kiểm tra “không có màu / cỡ chữ / font nằm ngoài token” — chạy được trong CI. |
| [`CHANGELOG.md`](CHANGELOG.md) | Lịch sử phiên bản bộ UX/UI. |

## Cách dùng nhanh
```bash
# 1. Nhúng token
<link rel="stylesheet" href="tokens.css">

# 2. Kiểm tra gói/mã nguồn không dùng giá trị rời (thoát mã 1 nếu có vi phạm)
node lint-tokens.mjs            # quét cả gói này
node lint-tokens.mjs ../../../platform/web/src   # quét mã nguồn sản phẩm
```

## Nguyên tắc cho dev
1. **Không viết giá trị rời.** Màu = `var(--color-*)`, cỡ chữ = `var(--fs-*)` hoặc lớp `.t-*`, khoảng cách = `var(--space-*)`.
2. **Mọi thành phần có đủ 6 trạng thái:** mặc định · hover · focus · active · disabled · error (xem `02-design-system/components.html`).
3. **Văn bản hiển thị lấy từ tệp chuỗi** (không viết cứng trong JSX) để sau này thêm ngôn ngữ khác.
4. **Văn bản UI đã thống nhất** trong `03-screens/SCREENS.md` và prototype — dùng đúng từ ngữ ở đó (ví dụ “Hồ sơ”, “Địa bàn”, “Cán bộ trực”).
