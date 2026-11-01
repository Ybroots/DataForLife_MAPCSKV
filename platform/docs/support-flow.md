# Luồng hỗ trợ người dân

Ngày chốt: 2026-11-01. Phạm vi: Bản đồ số CSKV, địa bàn thí điểm Xuân Hương.

Tài liệu này trả lời một câu hỏi: khi người dân cần giúp, **ai** nhận, **trong bao lâu**, và **ai tiếp theo** nếu người đó không kịp.
Mỗi bước ghi rõ trạng thái: **Đã có** (hệ thống đang làm đúng như mô tả), **Chốt** (quy tắc đã quyết định, cần cấu hình hoặc phát triển thêm), **Chờ ngoài** (phụ thuộc đơn vị khác).

## Ba tầng hỗ trợ

| Tầng | Ai | Làm gì | Trạng thái |
| --- | --- | --- | --- |
| 1 | Cán bộ CSKV trực của địa bàn | Tiếp nhận, xác minh, xử lý, trả lời người dân | Đã có (tài khoản `canbo01` đến `canbo05`, chỉ địa bàn Xuân Hương) |
| 2 | Chỉ huy CSKV địa bàn | Nhận hồ sơ quá hạn, phân công lại, quyết định chuyển tuyến | Chốt. Có sẵn loại tài khoản `supervisor` trong dữ liệu nhưng chưa có giao diện hay quy tắc tự chuyển |
| 3 | Tổng đài 112/113 | Xử lý khẩn cấp ngoài khả năng của CSKV | Chốt là đích chuyển tuyến. Chờ ngoài: chưa nối, `emergencyDispatchConnected=false` |

Trợ lý AI và danh bạ không thuộc tầng nào: chỉ hướng dẫn thủ tục và chỉ số điện thoại, không nhận hay xử lý hồ sơ.

## Theo loại yêu cầu

### 1. SOS

```text
Người dân giữ nút 3 giây
  → triggered → dispatched          (vào hàng đợi của địa bàn; cổng cán bộ hiện màn hình đỏ toàn màn hình kèm còi báo động)
  → Cán bộ xác nhận trong 5 phút    → acknowledged → responding → resolved → closed
  → Quá 5 phút không ai xác nhận    → chỉ huy nhận; chỉ huy không xác nhận tiếp 5 phút → escalated (112/113)
```

- Đã có: hàng đợi theo địa bàn, âm báo, xác nhận hai bước khi kết thúc, ghi chú bắt buộc ở mọi lần chuyển trạng thái, người dân hủy được.
- Đã có: địa bàn không có cán bộ trực thì hệ thống từ chối tạo SOS và nói người dân gọi 112 hoặc 113 (`NO_DUTY_OFFICER`).
- Đã có: mốc 5 phút đã dùng để đếm "quá hạn" trong báo cáo cuối ca.
- Chốt, chưa làm: tự leo thang theo mốc 5 phút, thông báo đẩy cho cán bộ khi cổng đóng, nối 112/113.
- Nhãn bắt buộc đến khi nối 112/113: "SOS chưa phải kênh khẩn cấp chính thức; tình huống nguy hiểm đến tính mạng hãy gọi 113 hoặc 114 hoặc 115".

### 2. Phản ánh

```text
submitted → received (cán bộ nhận trong 15 phút)
         → assigned (người phụ trách) → verifying → processing → resolved → closed
         → rejected (ngoài phạm vi, kèm lý do gửi người dân)
```

- Đã có: tự nhận hồ sơ, trao đổi hai chiều, yêu cầu bổ sung ảnh hoặc video, người dân đánh giá hài lòng sau khi xong, một người phụ trách mỗi hồ sơ (cán bộ khác không đè được).
- Đã có: mốc 15 phút đã dùng để đếm "quá hạn".
- Chốt, chưa làm: hồ sơ quá 15 phút hiện trong danh sách của chỉ huy; chỉ huy được chuyển hồ sơ sang cán bộ khác.
- Phản ánh vượt thẩm quyền (hình sự nghiêm trọng, cần lực lượng khác): cán bộ chuyển `rejected` kèm hướng dẫn gọi 113, hoặc báo chỉ huy chuyển tuyến.

### 3. Cảnh báo khu vực

```text
Cán bộ chọn vị trí (bấm bản đồ hoặc nhập tọa độ) + nội dung + thời gian hiệu lực
  → hiện ngay trên bản đồ và mục Cảnh báo của người dân (tự cập nhật mỗi 60 giây)
  → gửi thông báo đẩy tới thiết bị đã bật thông báo của địa bàn
```

- Vị trí bắt buộc và phải nằm trong ranh địa bàn của cán bộ; máy chủ kiểm tra lại bằng ranh PostGIS.
- Cán bộ thấy cảnh báo đang hiệu lực trên bản đồ trực ban của mình (làm mới mỗi 15 giây).
- Chưa kiểm thử trên điện thoại thật: thông báo đẩy qua Firebase.

### 4. Hỏi thủ tục, tìm đơn vị

Người dân dùng danh bạ, hotline và trợ lý AI trên bản đồ. Câu trả lời của AI phải lấy từ kho tri thức đã duyệt; hiện chưa có kho này nên trợ lý đang chờ cấu hình.

## Quy tắc chung

1. Mỗi hồ sơ có đúng một người phụ trách tại một thời điểm; ai nhận thì tên người đó hiện cho người dân.
2. Mọi chuyển trạng thái ghi người làm, giờ và ghi chú; người dân đọc được phần ghi chú công khai.
3. Cán bộ chỉ thấy và xử lý hồ sơ của địa bàn mình.
4. Không có cán bộ trực thì không nhận hồ sơ khẩn: người dân được hướng dẫn gọi 112 hoặc 113 ngay.
5. Hệ thống nào chưa nối thật thì giao diện nói rõ là chưa nối; không giả lập kết quả.

## Cần bên ngoài chốt trước khi mở cho người dân thật

- Người giữ vai trò chỉ huy của địa bàn và cách báo cho họ (tài khoản, số điện thoại trực).
- Đầu mối và quy trình chuyển tuyến sang 112/113, kèm diễn tập.
- Mốc thời gian 5 phút và 15 phút có được đơn vị chấp nhận không; đổi mốc chỉ cần sửa cấu hình, không đổi luồng.

## Màn hình báo động SOS trên cổng cán bộ

- Khi có SOS chưa ai nhận (trạng thái `triggered`/`dispatched`) trong địa bàn, mọi cán bộ đang mở cổng thấy màn hình đỏ toàn màn hình, còi hú liên tục và rung (trên điện thoại). Hàng đợi tải lại mỗi 8 giây nên chậm nhất khoảng 8 giây sau khi người dân bấm.
- **Nhận xử lý ngay**: chuyển SOS sang `acknowledged`, giao cho cán bộ bấm, và gửi cho người dân dòng “Cán bộ khu vực đã nhận tín hiệu SOS và đang liên hệ với bạn.” Màn hình đỏ của các cán bộ khác tự tắt ở lần tải sau.
- **Xem hồ sơ trước**: mở hồ sơ, tắt màn hình đỏ cho SOS đó; SOS vẫn nằm đầu hàng đợi (viền đỏ), chuông nhắc 30 giây một lần, và màn hình đỏ hiện lại sau 2 phút nếu vẫn chưa ai nhận.
- **Tắt còi**: chỉ tắt tiếng cho SOS đang hiện; SOS mới làm còi kêu lại. Nút “Còi bật/Còi tắt” ở thanh trên tắt hẳn tiếng trên máy đó (màn hình đỏ vẫn hiện).
- Trình duyệt chỉ phát tiếng sau khi cán bộ đã bấm hoặc gõ trên trang. Sau khi tải lại trang, màn hình đỏ hiện ngay và có nút “Bấm để bật còi báo động”.
- Giới hạn: chỉ hoạt động khi cổng cán bộ đang mở. Nếu tab bị ẩn lâu hơn 5 phút, Chrome giãn lịch tải lại xuống khoảng 1 phút một lần, nên còi có thể chậm đến 1 phút; máy trực nên để cổng cán bộ ở tab đang mở. Khi đóng trình duyệt hoặc ứng dụng chạy nền trên điện thoại thì không có còi; việc đó cần thông báo đẩy cho cán bộ (chưa làm).

