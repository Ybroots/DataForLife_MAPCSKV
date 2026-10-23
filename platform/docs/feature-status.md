# Trạng thái chức năng Lâm Đồng

Rà soát phát hành 28/08/2026: tra cứu công khai phủ đủ **124 địa bàn / 124 ranh giới** từ nguồn gốc, 276 liên hệ địa bàn + 20 liên hệ phòng nghiệp vụ/đồn KCN, 34 hotline. Phạm vi dữ liệu công khai toàn tỉnh không đồng nghĩa đã có cán bộ trực ban cho mọi địa bàn; tài khoản và phân công nghiệp vụ vẫn là pilot Xuân Hương. Chi tiết kiểm thử tại `release-20260828.md`.

Quy ước:

- **Hoạt động**: đã có API, dữ liệu lưu Postgres/PostGIS và giao diện sử dụng được.
- **Hoạt động local**: luồng nội bộ chạy đầy đủ nhưng chưa kết nối hệ thống bên ngoài.
- **Đang phát triển**: không giả lập như dịch vụ thật; chờ tích hợp hoặc phê duyệt nghiệp vụ.

Phạm vi pilot Xuân Hương hiện dùng mô hình một cấp: người dân được xem bản đồ, danh bạ và chuẩn bị biểu mẫu công khai mà không cần đăng nhập; đăng nhập chỉ bắt buộc tại thời điểm gửi/theo dõi phản ánh, kích hoạt/theo dõi SOS hoặc đánh giá. CSKV Công an phường trực tiếp tiếp nhận và xử lý trọn quy trình. Đăng nhập người dân hiện là ngăn trượt mô phỏng VNeID bằng số điện thoại và mật khẩu local, chưa phải kết nối định danh thật. Vai trò chỉ huy được tạm ẩn để phát triển sau.

## Ứng dụng người dân

| Mã | Trạng thái | Phạm vi hiện tại |
|---|---|---|
| FR-CD-01 | Hoạt động | Bản đồ, ranh giới 124 địa bàn, tìm tên/mã địa bàn và tra cứu bằng tọa độ; GPS cần HTTPS và quyền thiết bị |
| FR-CD-02 | Hoạt động | Đủ 296 liên hệ công khai, trụ sở, phòng nghiệp vụ/đồn KCN và 34 hotline; không tự tạo tọa độ trụ sở |
| FR-CD-03 | Hoạt động | Cảnh báo đang hiệu lực do cổng CSKV phát hành |
| FR-CD-04 | Hoạt động local | Có phiên đăng nhập số điện thoại/mật khẩu mang nhãn mô phỏng; tích hợp và xác thực VNeID thật đang phát triển |
| FR-CD-05 | Hoạt động | Phản ánh có bản đồ chọn vị trí, ảnh hoặc video, kiểm tra đầu vào và yêu cầu đăng nhập ngay trước khi gửi |
| FR-CD-06 | Đang phát triển | Chờ AI đa phương thức và cơ chế người dân duyệt trước khi gửi |
| FR-CD-07 | Hoạt động | Timeline, cán bộ phụ trách, trao đổi và bổ sung media |
| FR-CD-08 | Hoạt động nội bộ pilot | SOS trên bản đồ; nút mở trình gọi 112/113 dùng được trước đăng nhập nhưng không tự kết nối hay điều phối qua các tổng đài, yêu cầu phiên người dân mô phỏng để gửi SOS nội bộ, giữ đủ 3 giây để gửi đúng một lần, có bản đồ vị trí, mã tiếp nhận và luồng trực ban |
| FR-CD-09 | Tích hợp local, chờ cấu hình | Trợ lý hỏi đáp địa bàn/danh bạ/cảnh báo công khai với nút xem trên bản đồ; hỗ trợ cấu hình OpenAI hoặc Gemini tại server. Chưa có API key/model được chọn nên AI vẫn hiển thị chưa kết nối; thủ tục pháp lý và kho tri thức đã duyệt chưa tích hợp. Xem `ai-map-integration.md` |
| FR-CD-10 | Hoạt động local | Thông báo trong cổng cán bộ; SMS/Web Push đang phát triển |
| FR-CD-11 | Hoạt động | Chỉ chọn được phản ánh đã xử lý/đóng để đánh giá 1–5 sao; điểm và góp ý hiển thị trong chi tiết hồ sơ của cán bộ |
| FR-CD-12 | Đang phát triển | Chờ hàng đợi offline, mã hóa thiết bị và cơ chế đồng bộ xung đột |

## Ứng dụng cán bộ/CSKV

| Mã | Trạng thái | Phạm vi hiện tại |
|---|---|---|
| FR-CB-01 | Hoạt động | Dashboard SOS mở, tổng hồ sơ, chưa phân công và quá SLA |
| FR-CB-02 | Hoạt động | Tìm kiếm, lọc phạm vi/loại, sắp xếp và lưu trạng thái URL |
| FR-CB-03 | Hoạt động | Chi tiết người gửi, vị trí, media, phân công, lịch sử xử lý và đánh giá của người dân; AI gợi ý đang phát triển |
| FR-CB-04 | Hoạt động pilot | CSKV Xuân Hương trực tiếp tiếp nhận, tự nhận, xác minh, xử lý, kết quả và đóng/từ chối |
| FR-CB-05 | Hoạt động | Trao đổi hai chiều và yêu cầu/bổ sung ảnh hoặc video |
| FR-CB-06 | Đang phát triển | Chờ AI phân loại, chống trùng và phân tích ảnh |
| FR-CB-07 | Hoạt động một phần | GIS địa bàn/hồ sơ hoạt động; camera đang phát triển |
| FR-CB-08 | Hoạt động | Tạo và phát hành cảnh báo theo địa bàn/thời gian hiệu lực |
| FR-CB-09 | Hoạt động | Lập lịch, bắt đầu, tạm dừng, tiếp tục, check-in GPS và kết thúc tuần tra |
| FR-CB-10 | Hoạt động local | Thông báo công vụ trong hệ thống; push/lịch họp ngoài hệ thống đang phát triển |
| FR-CB-11 | Hoạt động | Tổng hợp số liệu trong ngày, ghi chú bàn giao và xác nhận báo cáo cuối ca |
