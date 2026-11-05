# Vai trò chỉ huy và phân quyền cán bộ theo khu vực

## Mô hình
- `workflow_actors.actor_type = 'officer'` + `service_area_id`: cán bộ chỉ xem và xử lý hồ sơ phản ánh, SOS của **khu vực mình**. Cán bộ không có khu vực vẫn thấy toàn phường (tương thích cũ).
- `actor_type = 'supervisor'` (chỉ huy): xem toàn bộ hồ sơ, SOS, tin nhắn, báo cáo của phường; **chỉ đọc**, mọi thao tác ghi trên hồ sơ (chuyển trạng thái, nhắn tin, tải tệp, gợi ý AI, phân công) trả 403. Không có chức năng phân công hồ sơ. Quyền duy nhất ngoài việc xem là **quản lý tài khoản cán bộ** (mục dưới), không liên quan đến việc xử lý hồ sơ.
- Hồ sơ chưa gán khu vực (`service_area_id` rỗng) chỉ chỉ huy và cán bộ không gắn khu vực thấy được.
- Thông báo đẩy: cán bộ chỉ nhận của khu vực mình; chỉ huy nhận của toàn phường.

## Demo phường Xuân Hương (migration 021)
| Tài khoản | Cán bộ (mẫu từ danh sách CSKV) | Khu vực |
|---|---|---|
| canbo01 | Vũ Tuấn Huy · 0982255229 | XH-P1 |
| canbo02 | Trịnh Hồ Quang Trung · 0388404875 | XH-P2 |
| canbo03 | Huỳnh Quốc Nam · 0918080597 | XH-P3 |
| canbo04 | Cao Đức Thanh · 0397202204 | XH-P4 |
| canbo05 | Nguyễn Văn Tùng · 0972345246 | XH-P10 |
| chihuy01 | Chỉ huy Công an phường Xuân Hương | toàn phường |

Việc ghép tổ dân phố → khu vực là **dữ liệu minh hoạ**, chưa có bảng đối chiếu chính thức. Tên và số điện thoại hiển thị ở trang "Cảnh sát khu vực" (danh bạ công khai) nhờ cập nhật `directory_entries.service_area_id`.

## Màn hình và API
- Chỉ huy: tab **Khu vực** (`GET /v1/commander/area-officers?period=day|month|year&date=YYYY-MM-DD`) hiển thị từng khu vực, cán bộ, số hồ sơ/SOS và điểm đánh giá của người dân (trung bình, số lượt, số lượt ≤ 2 sao) tính theo cán bộ phụ trách (`assigned_officer_id`) từ `satisfaction_ratings` và `sos_ratings`.
- Mốc kỳ báo cáo theo giờ Việt Nam (UTC+7).
- Mỗi khu vực trong tab Khu vực có thêm phân bố số sao (1–5) của cán bộ trong kỳ và danh sách 10 đánh giá gần nhất kèm nội dung góp ý (không kèm danh tính người dân).
- Cán bộ khu vực: hàng đợi, thông báo đẩy, danh sách đồng nghiệp và thống kê chỉ gồm khu vực của mình (lọc ở máy chủ). Bản đồ trực ban chỉ vẽ ranh khu vực đó và các điểm phản ánh, SOS, cảnh báo, điểm nghiệp vụ nằm trong ranh; ô chọn vị trí cảnh báo/điểm nghiệp vụ chỉ nhận vị trí trong khu vực (lọc ở giao diện, `web/src/area-scope.ts`). Chỉ huy xem toàn phường.
- Migration 023 đổi tên "Khu vực Phường N cũ" thành "Khu vực Phường N".

## Cấp tài khoản chỉ huy
Sau khi triển khai (migration 021 được `deploy-update.sh` áp dụng tự động):
```
npm run accounts:provision-officers -- --credentials-output=/đường/dẫn/tuyệt/đối/ngoài/repo
```
Tệp mật khẩu sinh ra phải lưu ngoài repo; đổi mật khẩu sau lần đăng nhập đầu. Nếu tài khoản được tạo **sau** migration, chạy lại deploy để tên/khu vực được gắn vào.

## Giao hồ sơ về đúng khu vực (migration 024)

Hồ sơ phản ánh và SOS được giao vào khu vực chứa điểm gửi khi khu vực đó đã xác minh ranh giới **hoặc đã có cán bộ phụ trách** (migration 021). Ranh giới Xuân Hương vẫn là dữ liệu trình diễn nên điều kiện thứ hai là điều kiện đang dùng; khu vực chưa có cán bộ thì hồ sơ không có khu vực và chỉ chỉ huy hoặc cán bộ chưa gắn khu vực nhìn thấy. Migration 024 gán khu vực cho các hồ sơ và SOS đã gửi trước đó theo vị trí (điểm nằm đúng trên ranh giới hai khu vực được giữ nguyên).

## Chỉ huy quản lý tài khoản cán bộ (migration 025)

Trong tab **Khu vực**, phần “Tài khoản cán bộ” cho chỉ huy, với cán bộ **cùng phường**:

| Việc | Quy tắc |
|---|---|
| Đổi tên đăng nhập | 3–100 ký tự, chỉ chữ thường không dấu, số, `.`, `_`, `-`; không được trùng tên đã có (kể cả tài khoản cấu hình sẵn ở máy chủ). Tên cũ được giải phóng. |
| Đặt mật khẩu | Tự nhập (tối thiểu 8 ký tự) hoặc bấm “Tạo mật khẩu”: máy chủ sinh 12 ký tự dễ đọc (không có `1/l/I`, `0/O/o`). Mật khẩu tự tạo chỉ có trong phản hồi của đúng lần gọi đó, giao diện hiện một lần kèm nút sao chép; mật khẩu do chỉ huy nhập không bao giờ được trả lại. Không lưu mật khẩu dạng đọc được ở đâu. |
| Đổi khu vực | Chọn khu vực bất kỳ của phường hoặc “Chưa gắn khu vực” (thấy cả phường). Hồ sơ mới đến đúng người; hồ sơ cũ giữ nguyên người đang phụ trách. |

Giới hạn:
- Chỉ chỉ huy làm được (cán bộ gọi các tuyến này nhận 403). Chỉ huy vẫn không xử lý được hồ sơ.
- Không sửa được tài khoản chỉ huy (kể cả của mình: 403) và cán bộ phường khác (404).
- Tài khoản cán bộ cấu hình bằng biến môi trường ở máy chủ (`API_OFFICER_USERNAME`) không nằm trong danh sách và không sửa được ở đây.
- Mỗi thay đổi ghi vào bảng `officer_account_audit_events` (ai đổi, đổi gì, lúc nào; đổi mật khẩu chỉ ghi “đã đặt”). Ghi trong cùng giao dịch với thay đổi nên không có thay đổi nào thiếu nhật ký. Bảng `workflow_audit_events` chỉ dành cho hồ sơ/SOS nên không dùng được cho việc này.
- Đổi tên đăng nhập hoặc mật khẩu thì mọi phiên đăng nhập đang có của cán bộ đó bị vô hiệu. Danh sách này nằm trong bộ nhớ của API nên mất khi API khởi động lại (phiên cán bộ sống tối đa 8 giờ), giống cách thu hồi phiên khi đăng xuất. Đổi khu vực không đăng xuất.

API (đều cần phiên chỉ huy):
- `GET /v1/commander/officers`: danh sách `{ id, username, displayName, phone, serviceArea }`, không có mật khẩu hay bản băm.
- `POST /v1/commander/officers/:id/update`: thân `{ username?, serviceAreaCode? }` (`serviceAreaCode: null` để bỏ gắn khu vực). Trùng tên trả 409.
- `POST /v1/commander/officers/:id/password`: thân `{ password }` hoặc `{ generate: true }`; kết quả có `generatedPassword` khi tạo tự động.

Việc đổi phân công (ví dụ chuyển Cao Đức Thanh sang P.1, Vũ Tuấn Huy sang P.4) làm trên giao diện bằng “Đổi khu vực”; không cần migration đổi cứng.

## Báo cáo thống kê của chỉ huy

`GET /v1/commander/report?period=day|month|year&date=YYYY-MM-DD` (chỉ chỉ huy, chỉ đọc, không cần migration). Màn Báo cáo của chỉ huy hiển thị thêm các phần sau ngoài báo cáo chung của địa bàn:

- **So với kỳ trước**: phản ánh, SOS, đã xử lý, tỷ lệ được phản hồi, thời gian phản hồi/xác nhận SOS/xử lý trung bình, điểm hài lòng. Kỳ trước là ngày hôm trước, tháng trước hoặc năm trước.
- **Cần chú ý**: SOS chưa có người xác nhận, SOS chuyển tuyến, hồ sơ quá hạn, khu vực chưa có cán bộ, hồ sơ chưa xác định khu vực, cán bộ bị đánh giá từ 2 sao trở xuống.
- **Hồ sơ chờ tiếp nhận quá hạn**: phản ánh chưa tiếp nhận quá 15 phút, SOS chưa xác nhận quá 5 phút (tại thời điểm xem, 10 hồ sơ cũ nhất).
- **Theo khu vực** và **theo cán bộ** (hồ sơ được giao cho từng người), **giờ cao điểm** và **theo thứ trong tuần** (giờ Việt Nam).

File CSV và bản in/PDF của chỉ huy có thêm các bảng này. Mốc "phản hồi" của phản ánh là lần đầu cán bộ hoặc chỉ huy đổi trạng thái; của SOS là `acknowledged_at`. SOS người dân đã hủy không được tính.
