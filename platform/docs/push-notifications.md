# Thông báo ngoài màn hình điện thoại (Android)

Người dân nhận thông báo trên thanh trạng thái điện thoại, kể cả khi không mở ứng dụng:

- **Cảnh báo khu vực** do cán bộ phát hành: gửi tới thiết bị đã chọn theo dõi địa bàn đó (tối đa 3 địa bàn/thiết bị). Cảnh báo là thông tin công khai.
- **Cập nhật phản ánh/SOS** (tiếp nhận, phân công, xử lý, yêu cầu bổ sung, kết quả): chỉ gửi tới thiết bị đang đăng nhập đúng tài khoản. Màn hình khóa chỉ hiện tiêu đề trạng thái và mã hồ sơ, không hiện mô tả vụ việc hay lời nhắn của cán bộ.

Trạng thái: **mã nguồn hoàn chỉnh, đã kiểm thử bằng giả lập, chưa thử trên điện thoại thật và chưa gửi qua FCM thật.** Tính năng chỉ chạy sau khi chủ dự án làm các bước ở mục 1.

## 1. Việc chủ dự án cần làm (một lần)

1. **Tạo dự án Firebase** (console.firebase.google.com), thêm ứng dụng Android với tên gói `com.bandosocskv.mobile`, tải `google-services.json` và đặt vào `platform/web/android-native/app/google-services.json`. Có file này thì `npm run android:apk` tự bật thông báo (script in dòng `Thong bao day (FCM): BAT`). Không có file thì APK vẫn chạy bình thường, mục thông báo hiện "đang phát triển" và không gọi plugin nào.
2. **Tạo khóa dịch vụ cho máy chủ**: Firebase Console › Cài đặt dự án › Tài khoản dịch vụ › Tạo khóa riêng mới. Đây là **bí mật**: không đưa vào git, không gửi qua chat. Tải lên VPS, ví dụ:
   ```bash
   install -d -o dataforlife -m 700 /opt/dataforlife/secrets
   install -o dataforlife -m 600 fcm.json /opt/dataforlife/secrets/fcm.json
   ```
3. **Cấu hình API**: thêm vào `/opt/dataforlife/repo/platform/.env` dòng `FCM_SERVICE_ACCOUNT_FILE=/opt/dataforlife/secrets/fcm.json`, rồi áp migration `013_push_devices.sql` (chỉ file này, như đã làm với 012) và khởi động lại `dataforlife-api`.
4. Kiểm tra: `curl -s http://127.0.0.1:3001/v1/push/status` phải trả `{"data":{"enabled":true}}`; nhật ký API ghi `push on`.
5. Dựng lại APK, cài lên điện thoại, bật thông báo, rồi thử theo mục 4.

## 2. Cách hoạt động

- App xin quyền thông báo (Android 13+), lấy mã thiết bị FCM và gọi `POST /v1/push/devices` với `{token, areaCodes}`. Nếu đang đăng nhập, phiên đăng nhập được gắn vào thiết bị; đăng xuất thì app đồng bộ lại để gỡ liên kết.
- API quét mỗi 15 giây (`PUSH_POLL_INTERVAL_MS`): cảnh báo `published` đang hiệu lực và các sự kiện trong view `citizen_notification_events`, tạo trong 30 phút gần nhất, chưa gửi cho thiết bị. Mỗi (sự kiện, thiết bị) chỉ gửi một lần nhờ bảng `push_deliveries`, kể cả khi API khởi động lại hoặc chạy nhiều tiến trình. Gửi lỗi tạm thời được thử lại tối đa 3 lần cách nhau 1 phút.
- Cơ chế quét không sửa luồng nghiệp vụ: mọi cảnh báo và cập nhật hồ sơ đã ghi vào cơ sở dữ liệu đều được đẩy, dù tạo bằng đường nào.
- Mã thiết bị bị Google thu hồi (gỡ app, xóa dữ liệu) tự bị xóa khỏi `push_devices`. Thiết bị không đồng bộ 120 ngày bị dọn.
- Gửi bằng FCM HTTP v1, ký JWT bằng khóa dịch vụ, không dùng thư viện ngoài. Khóa không bao giờ vào APK hay log.

## 3. Quyền riêng tư

Máy chủ lưu: mã thiết bị FCM, mã tài khoản người dân (chỉ khi đang đăng nhập), mã các địa bàn theo dõi, thời điểm cập nhật. Không lưu vị trí GPS. Nội dung thông báo đi qua Google (FCM): cảnh báo công khai, hoặc tiêu đề trạng thái và mã hồ sơ. Chủ hệ thống cần xem chính sách dữ liệu của Google/Firebase và cập nhật thông báo quyền riêng tư của ứng dụng trước khi phát hành rộng.

## 4. Kiểm thử bắt buộc trên điện thoại thật

1. Cài APK, chọn một phường, trả lời lời hỏi bật thông báo (chọn Cho phép).
2. Đăng nhập cán bộ trên web, phát hành một cảnh báo cho phường đó. Trong tối đa ~20 giây điện thoại phải hiện thông báo kể cả khi đã thoát app; bấm vào phải mở trang Cảnh báo của đúng phường.
3. Gửi một phản ánh bằng tài khoản người dân, để cán bộ đổi trạng thái. Điện thoại phải hiện "Phản ánh ..." kèm mã hồ sơ, không có mô tả vụ việc; bấm vào mở đúng hồ sơ.
4. Đăng xuất rồi để cán bộ đổi trạng thái tiếp: không được hiện thông báo hồ sơ.
5. Tắt thông báo trong app, phát hành cảnh báo mới: không được hiện. Từ chối quyền ở lần hỏi đầu: app phải hướng dẫn vào Cài đặt.
6. Thử Android 12 trở xuống (không có hộp xin quyền) và máy tiết kiệm pin.

## 5. Đã kiểm thử và chưa kiểm thử

Đã: 22 test API (ký JWT và payload FCM, phân loại lỗi, định tuyến đăng ký, giới hạn tần suất, nội dung màn hình khóa); 8 test chạy SQL thật trên PostgreSQL 16 (gửi một lần, không gửi trùng khi chạy song song, thử lại, đúng chủ tài khoản, cảnh báo hết hạn/hủy bị bỏ qua, dọn thiết bị); 10 test logic app; kịch bản trình duyệt với cầu nối Capacitor giả lập (xin quyền, đăng ký, biểu ngữ, bấm mở đúng đích, theo dõi/bỏ theo dõi, tắt, bị từ chối quyền, bản không có Firebase).

Chưa: gửi tới FCM thật, nhận trên điện thoại thật, hành vi pin/Doze của từng hãng máy, mở app từ thông báo khi app đã bị tắt hẳn (logic có, chưa thử trên máy). Tin nhắn Android khi app ở nền do hệ điều hành hiển thị nên dùng biểu tượng `ic_stat_cskv` và kênh `alerts`/`cases` khai báo trong manifest.

## 6. Giới hạn đã biết

- Độ trễ tối đa bằng chu kỳ quét (mặc định 15 giây) cộng thời gian FCM.
- API chạy một tiến trình trên một VPS: bộ giới hạn tần suất ở trong bộ nhớ, đủ cho pilot.
- Đăng ký thiết bị không cần đăng nhập nên có thể bị gửi rác vào bảng; có giới hạn 30 lần/10 phút/IP và độ dài mã, nhưng chưa có hạn mức tổng số thiết bị.
- Chưa có tùy chọn mức độ cảnh báo (chỉ nhận cảnh báo khẩn) hay giờ yên lặng.
