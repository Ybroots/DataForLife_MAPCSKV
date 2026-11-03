# Lịch sử phiên bản

## 1.0.0 — 2026-11-02
Phát hành đầu tiên bộ UX/UI **Bản đồ số Cảnh sát khu vực tỉnh Lâm Đồng**.

**Thêm mới**
- 01 UX: giả định, 3 persona, 5 hành trình, sitemap, 7 luồng người dùng.
- 02 Design System: 26 màu, 7 cấp chữ, thang khoảng cách 4 px, các thành phần (nút, ô nhập, chọn, thẻ, bảng, điều hướng, lớp phủ, rỗng/tải/lỗi…) × 6 trạng thái, bộ biểu tượng Lucide.
- 03 Màn hình: 14 màn người dân + 6 màn cán bộ, 84 trạng thái, mỗi trạng thái có ảnh UI và ảnh phác thảo.
- 04 Prototype tương tác 2 luồng chính (người dân, cán bộ).
- 05 Bàn giao: token (JSON + CSS), đặc tả tương tác, responsive, kiểm tra tiếp cận, script lint token.

**Thay đổi so với giao diện đang chạy** (đã áp dụng vào mã nguồn ứng dụng ngày 2026-11-02)
- Header điện thoại cân đối, không tràn chữ; thêm dòng “tỉnh Lâm Đồng” trên màn chờ.
- Bỏ hàng 4 phím tắt trên bản đồ (Gọi 113 / Cảnh báo / Chỉ đường / Hỏi trợ lý) — các chức năng này đã có ở nút SOS, tab và menu Tính năng.
- Gộp ô tìm kiếm + ô chọn địa bàn + “Toàn tỉnh” trên điện thoại: một ô tìm kiếm, nút ✕ quay về toàn tỉnh.

**Đề xuất mới (chưa có trong code, cần xác nhận)**
- SOS giữ 3 giây; ghi chú bắt buộc ≥ 20 ký tự khi xong/đóng hồ sơ; đóng hồ sơ xác nhận 2 lần; báo động quá 2 phút chuyển cán bộ dự phòng.
