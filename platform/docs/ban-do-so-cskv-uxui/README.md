# Bản đồ số Cảnh sát khu vực — Bộ UX/UI

**Phiên bản:** 1.0.0 · **Cập nhật:** 02/11/2026 · **Ngôn ngữ giao diện:** tiếng Việt
**Phạm vi:** App người dân (Android/web, điện thoại) + Cổng cán bộ (web, máy tính) của dự án *Bản đồ số Cảnh sát khu vực tỉnh Lâm Đồng*.

> **Đọc trước:** [`01-ux-overview/assumptions.md`](01-ux-overview/assumptions.md) — các giả định (mẫu yêu cầu còn ô trống nên đã đối chiếu với sản phẩm đang chạy).

## Mục lục
| Thư mục | Nội dung | Mở trước |
|---|---|---|
| [`01-ux-overview/`](01-ux-overview/) | Giả định · 3 persona · 5 hành trình · sitemap & điều hướng · 7 luồng người dùng | `personas.md`, `sitemap.md` |
| [`02-design-system/`](02-design-system/) | Token (màu, chữ, khoảng cách, bo góc, đổ bóng, biểu tượng) · thư viện thành phần × 6 trạng thái | `foundations.html`, `components.html` |
| [`03-screens/`](03-screens/) | 20 màn hình (14 người dân + 6 cán bộ), 84 trạng thái, mỗi trạng thái có ảnh UI + wireframe; đặc tả từng màn | `index.html`, `SCREENS.md` |
| [`04-prototype/`](04-prototype/) | Prototype HTML tương tác cho 2 luồng chính | `index.html` |
| [`05-handoff/`](05-handoff/) | `tokens.json`/`tokens.css` · tương tác · responsive · tiếp cận · lint token · đối chiếu với code hiện có | `README.md`, `token-map.md` |

## Cách dùng
| Bạn là | Làm gì |
|---|---|
| **Chủ đầu tư** | Mở `04-prototype/index.html` và thử 2 luồng; xem `03-screens/index.html`; đọc mục *Điểm cần xác nhận* bên dưới |
| **Thiết kế** | `02-design-system/` là nguồn sự thật; thêm màn mới bằng thành phần có sẵn; chạy lint trước khi bàn giao |
| **Dev** | Nhúng `05-handoff/tokens.css`; dùng class trong `02-design-system/ds.css` làm tham chiếu; đọc `05-handoff/token-map.md` để biết chỗ code đang lệch |
| **Kiểm thử** | Dùng `05-handoff/accessibility-checklist.md` và các trạng thái ở `03-screens/SCREENS.md` làm ca kiểm thử |

Tất cả tệp `.html` mở trực tiếp bằng trình duyệt (không cần cài đặt hay mạng). Phông chữ Be Vietnam Pro / Noto Sans dùng nếu máy có, nếu không tự rơi về Segoe UI/hệ thống — bố cục không đổi.

Kiểm tra nhất quán token: `node 05-handoff/lint-tokens.mjs` → *“✓ Không có màu/cỡ chữ/font nào nằm ngoài token.”*

## Điểm chính của thiết kế
- **Khẩn cấp trước:** SOS (giữ 3 giây, có lối thoát **Gọi 113**) luôn nổi trên bản đồ; cán bộ nhận báo động toàn màn hình có còi.
- **Không bắt đăng nhập sớm:** tra cứu, danh bạ, cảnh báo dùng ngay; đăng nhập (tờ trượt) chỉ khi phản ánh/theo dõi.
- **Một việc chính mỗi màn:** cán bộ chỉ thấy một nút “việc cần làm tiếp” theo từng trạng thái hồ sơ.
- **Dành cho người lớn tuổi:** chữ ≥ 14 px, vùng chạm ≥ 44 px, nhãn chữ dưới biểu tượng, chịu được phóng chữ 115 %.
- **Nhất quán 100 % token:** 26 màu, 7 cấp chữ, thang khoảng cách 4 px; 26 cặp tương phản đều đạt WCAG 2.1 AA (hoặc miễn trừ có ghi chú).

## Điểm cần chủ đầu tư xác nhận
**Chức năng & nghiệp vụ (đề xuất mới, chưa có trong code)**
1. **SOS giữ 3 giây** để gửi (chống bấm nhầm) — đồng ý 3 giây hay ngắn/dài hơn? Có cho phép gửi bằng 1 chạm khi người dùng tắt chế độ an toàn không?
2. **Báo động quá 2 phút chưa ai nhận** → chuyển cán bộ dự phòng: ai là người dự phòng, thời hạn có phải 2 phút?
3. **Ghi kết quả bắt buộc ≥ 20 ký tự** và công tắc “Cho người dân đọc” khi hoàn thành/đóng hồ sơ; **đóng hồ sơ bấm 2 lần**.
4. Phát cảnh báo loại *An ninh* có cần **bước phê duyệt** của lãnh đạo trước khi hiện công khai?
5. Thông báo đẩy trên màn khoá chỉ ghi nội dung chung (“Có cập nhật hồ sơ PA-…”) — đồng ý?
6. Quy tắc **“Đánh giá” chỉ hỏi một lần/hồ sơ**, bỏ qua được — đồng ý?
7. **VNeID** chưa kết nối: màn đăng nhập hiện nêu rõ. Có kế hoạch tích hợp (ảnh hưởng C02)?

**Hình ảnh & thương hiệu**
8. Nhận diện lấy từ sản phẩm hiện có (đỏ `#D71935`, huy hiệu, Be Vietnam Pro/Noto Sans) — có **bộ nhận diện chính thức** của Công an tỉnh cần theo không?
9. Màu navy `#0B2447` cho màn chờ và các token mới thêm (`inCode: false` trong `tokens.json`, 8 token) — duyệt hay đổi?
10. **Chế độ tối** để backlog (ngoài v1.0) — có cần cho cổng cán bộ trực đêm?

**Kỹ thuật ảnh hưởng thiết kế**
11. Viền ô nhập đang dùng `--color-line` (1.31:1) — thiết kế đổi sang `--color-subtle` (3.14:1) để đạt WCAG; cho phép đổi trong code (G1 ở `05-handoff/token-map.md`)?
12. **Đóng gói font trong app Android** (thay vì tải Google Fonts) — đồng ý?
13. **Xuất báo cáo:** CSV UTF-8 có BOM, PDF A4 dọc có đầu trang đơn vị — có mẫu biểu chính thức của đơn vị không?
14. Mã sản phẩm hiện lệch token (1.663 giá trị rời) — chấp nhận **lộ trình chuyển đổi dần** ở `05-handoff/token-map.md` (mục 3)?

**Chưa kiểm chứng**
15. Persona/hành trình là **đại diện**, chưa qua phỏng vấn tại địa bàn; chưa thử trên máy Android thật (cần kiểm thử theo `accessibility-checklist.md`, mục 8).
