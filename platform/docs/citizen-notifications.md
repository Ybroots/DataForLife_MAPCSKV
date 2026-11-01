# Thông báo xử lý cho người dân

## Hành vi

- Chuông trên thanh đầu của web người dân, hiển thị tổng số thông báo chưa đọc.
- Hộp thông báo trượt từ phải sang trái; trên điện thoại dùng hết chiều rộng. Giữ màu đỏ và bộ icon hiện tại. Danh sách cuộn riêng, hỗ trợ bàn phím/Escape, khóa focus và nền phía sau, tôn trọng reduced-motion.
- Khách cần đăng nhập để xem. Nội dung gồm cập nhật trạng thái phản ánh/SOS, ghi chú được cán bộ chọn công khai, trao đổi và yêu cầu bổ sung ảnh/video.
- Chỉ thông báo cho chủ hồ sơ. Thay đổi trạng thái vẫn có thông báo chung khi ghi chú là nội bộ; nội dung ghi chú đó không được trả về API.
- Bộ lọc Tất cả/Chưa đọc, nút làm mới, tải thêm lịch sử. Chọn một thông báo mở đúng mã phản ánh hoặc SOS và lưu đã đọc. Nút “Đọc các mục đang hiện” chỉ đánh dấu tối đa 100 mục đã tải, không ảnh hưởng thông báo vừa phát sinh.
- Giữ trạng thái đã đọc qua reload và phiên đăng nhập. Thông báo vẫn có khi quay lại web sau thời gian offline.
- Có đường dẫn riêng theo mã hồ sơ; hồ sơ cũ ngoài giới hạn danh sách gần đây vẫn được tải trực tiếp, kiểm tra quyền sở hữu.

## Cơ chế

Migration `010_citizen_notifications.sql` thêm:

- View `citizen_notification_events`: đọc lịch sử đã commit của `incident_status_history`, `sos_status_history`, `incident_messages`. Không phụ thuộc worker/outbox để hiện thông báo trong ứng dụng; không nhân bản sự kiện sau mỗi lần tải.
- Bảng `citizen_notification_reads`: lưu xác nhận đã đọc theo tài khoản và ID thông báo. Không dùng localStorage để quyết định quyền truy cập hoặc lưu trạng thái đã đọc.

API:

- `GET /v1/citizen/notifications?limit=30&unread=0&cursor=...`: danh sách phân trang bằng cursor, tổng chưa đọc và cursor tiếp theo. Sắp theo thời điểm mới nhất, ID để phân xử cùng thời điểm.
- `POST /v1/citizen/notifications/read` với `ids`: chỉ xác nhận những ID thuộc tài khoản đã xác thực; gọi lặp không làm phát sinh bản ghi mới.
- `GET /v1/citizen/sos/:receiptCode`: đọc chính xác SOS của tài khoản, không trả ghi chú nội bộ.

Frontend đồng bộ mỗi 10 giây khi trang đang hiển thị, đồng thời tải lại khi mở chuông, quay lại tab hoặc có mạng. Request bị hủy khi thay tài khoản, đóng component hoặc đổi bộ lọc. Lỗi mạng có trạng thái và nút thử lại; không coi lỗi là “không có thông báo”.

Chuông này là **thông báo trong ứng dụng/web**. Ứng dụng Android còn có thể hiện thông báo ngoài màn hình điện thoại (FCM) cho cảnh báo khu vực và cập nhật hồ sơ khi đã cấu hình Firebase; xem `push-notifications.md`. Bản web chưa có Web Push hay SMS. Không gọi tổng đài hoặc dịch vụ bên ngoài.

## Kiểm thử local — 27/08/2026

- Unit/API: tạo thông báo trạng thái, ẩn ghi chú nội bộ, không báo lại tin do chính người dân gửi, yêu cầu bổ sung, quyền sở hữu, xác nhận đã đọc lặp, phân trang, thông báo mới vẫn chưa đọc sau khi đọc các mục trước, kiểm tra tham số và bảo vệ chi tiết SOS.
- `e2e/citizen_notifications.cjs`: hai phiên trình duyệt tách biệt, cán bộ chuyển trạng thái/gửi trao đổi qua giao diện; người dân nhận tự động, mở đúng hồ sơ, đọc rồi reload vẫn giữ trạng thái. Kiểm tra API với một định danh khác để xác nhận không đọc hay đánh dấu được thông báo của người khác.
- Kiểm tra fallback hồ sơ cũ bằng cách trả danh sách gần đây rỗng trong trình duyệt test; API chi tiết vẫn sử dụng database thật.
- Kích thước 320×568, 375×667, 844×390, 768×1024, 1440×900; không tràn ngang; focus không thoát dialog và trở lại nút chuông khi đóng.
- Chỉ tạo 2 hồ sơ test với ID riêng mỗi lần chạy; xóa chính các hồ sơ đó, lịch sử và thông báo test sau kiểm thử. Không thay đổi trạng thái đã đọc của các hồ sơ sẵn có.

Ảnh kiểm thử: `e2e/artifacts/citizen-notifications/`. Kiểm tra thêm bằng `npm run typecheck`, `npm test`, `npm run build`.
