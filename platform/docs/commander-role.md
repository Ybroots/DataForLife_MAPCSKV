# Vai trò chỉ huy và phân quyền cán bộ theo khu vực

## Mô hình
- `workflow_actors.actor_type = 'officer'` + `service_area_id`: cán bộ chỉ xem và xử lý hồ sơ phản ánh, SOS của **khu vực mình**. Cán bộ không có khu vực vẫn thấy toàn phường (tương thích cũ).
- `actor_type = 'supervisor'` (chỉ huy): xem toàn bộ hồ sơ, SOS, tin nhắn, báo cáo của phường; **chỉ đọc**, mọi thao tác ghi (chuyển trạng thái, nhắn tin, tải tệp, gợi ý AI, phân công) trả 403. Không có chức năng phân công.
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
- Cán bộ khu vực: hàng đợi, thông báo đẩy, danh sách đồng nghiệp và thống kê chỉ gồm khu vực của mình (lọc ở máy chủ). Bản đồ trực ban chỉ vẽ ranh khu vực đó và các điểm phản ánh, SOS, cảnh báo, điểm nghiệp vụ nằm trong ranh; ô chọn vị trí cảnh báo/điểm nghiệp vụ chỉ nhận vị trí trong khu vực (lọc ở giao diện, `web/src/area-scope.ts`). Chỉ huy xem toàn phường.
- Migration 023 đổi tên "Khu vực Phường N cũ" thành "Khu vực Phường N".

## Cấp tài khoản chỉ huy
Sau khi triển khai (migration 021 được `deploy-update.sh` áp dụng tự động):
```
npm run accounts:provision-officers -- --credentials-output=/đường/dẫn/tuyệt/đối/ngoài/repo
```
Tệp mật khẩu sinh ra phải lưu ngoài repo; đổi mật khẩu sau lần đăng nhập đầu. Nếu tài khoản được tạo **sau** migration, chạy lại deploy để tên/khu vực được gắn vào.
