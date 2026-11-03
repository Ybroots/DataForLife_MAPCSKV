# Giả định & phạm vi (đọc trước)

Mẫu yêu cầu gửi kèm còn các ô trống (`[Tên app]`, `[Tên dự án]`…). Theo chỉ dẫn "thiếu thông tin thì nêu giả định rồi làm tiếp", bộ UX/UI này được lập trên các giả định dưới đây — **đã đối chiếu với mã nguồn đang chạy** (`platform/web`) nên khớp sản phẩm thật.

| # | Mục | Giả định |
|---|---|---|
| 1 | Tên app | **Bản đồ số Cảnh sát khu vực** (tên hiển thị trên Android: "Bản đồ số Cảnh sát khu vực"; tên rút gọn trong header: "Bản đồ CSKV") |
| 2 | Dự án / khách hàng | Dự án *Bản đồ số CSKV* (bandosocskv.com) — **Công an tỉnh Lâm Đồng**; đơn vị triển khai: MobiFone Lâm Đồng |
| 3 | Mục tiêu | Giúp người dân tra cứu Cảnh sát khu vực phụ trách địa bàn, gửi phản ánh và cầu cứu khẩn cấp (SOS) kèm vị trí; giúp cán bộ nhận – xử lý – lưu hồ sơ và phát cảnh báo nhanh, có dấu vết |
| 4 | Người dùng chính | (a) **Người dân** mọi lứa tuổi trong tỉnh; (b) **Cán bộ CSKV trực địa bàn**; (c) người dùng phụ: lãnh đạo xem báo cáo (dùng chung cổng cán bộ) |
| 5 | Nền tảng | App người dân: **Android** (Capacitor, đóng gói từ web) + web responsive; Cổng cán bộ: **web trên máy tính** (có hỗ trợ điện thoại). iOS chưa phát hành nhưng thiết kế không phụ thuộc Android |
| 6 | Ngôn ngữ | **Chỉ tiếng Việt** (không song ngữ ở v1.0). Dành sẵn chỗ chứa văn bản dài hơn ~30 % |
| 7 | Nhận diện | Đỏ Công an `#D71935`, huy hiệu Công an (logo-transparent.png), font Be Vietnam Pro + Noto Sans — **lấy nguyên từ sản phẩm đang chạy**; thêm xanh navy `#0B2447` cho màn chờ |
| 8 | Chức năng / màn hình | Lấy từ sản phẩm hiện có: bản đồ, danh bạ, cảnh báo, phản ánh, theo dõi, SOS, thông báo, tài khoản, trợ lý AI, hướng dẫn, đánh giá; cổng cán bộ: hàng đợi, bản đồ trực ban, phát cảnh báo, lưu trữ & báo cáo, báo động SOS |
| 9 | Dữ liệu minh hoạ | Tên người, số điện thoại, mã hồ sơ trong màn hình là **dữ liệu giả**; địa danh (Phường Lâm Viên - Đà Lạt…) lấy theo dữ liệu demo |
| 10 | Chế độ tối | Ngoài phạm vi v1.0 (xem backlog) |

## Ngoài phạm vi
- Thiết kế cổng quản trị hệ thống (quản lý tài khoản cán bộ, danh mục địa bàn).
- Tích hợp VNeID (chưa kết nối — giao diện đã ghi rõ “VNeID chính thức chưa được kết nối”).
- Ứng dụng iOS và tablet riêng.

## Nguyên tắc thiết kế xuyên suốt
1. **Khẩn cấp trước** — SOS và gọi 113 luôn trong ≤ 2 thao tác; không bao giờ bị che.
2. **Một việc chính mỗi màn** — mỗi màn một hành động chính (nút đỏ); cán bộ chỉ thấy *việc cần làm tiếp*.
3. **Dễ cho người lớn tuổi** — chữ ≥ 14 px, vùng chạm ≥ 44 px, nhãn chữ dưới mọi biểu tượng quan trọng, câu ngắn, không thuật ngữ nội bộ.
4. **Không bắt đăng nhập sớm** — tra cứu, danh bạ, cảnh báo dùng được ngay; chỉ phản ánh/SOS/theo dõi cần tài khoản.
5. **Nói rõ khi lỗi** — mọi lỗi nêu chuyện gì xảy ra và bước tiếp theo; không mất dữ liệu người dùng đã nhập.
6. **Nhất quán token** — mọi màu/cỡ chữ/khoảng cách đến từ `02-design-system/tokens.json`.
