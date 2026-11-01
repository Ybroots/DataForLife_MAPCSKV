# Workflow phản ánh và SOS local

Ngày cập nhật: 2026-08-26
Phạm vi: PostGIS/API/app người dân/workspace CSKV trong môi trường local.

## Hai bề mặt

- App người dân (`/`) mở bản đồ làm màn hình chính trên điện thoại; các tab chính
  là Bản đồ, Danh bạ, Phản ánh và SOS.
- Workspace CSKV (`/?portal=police`) có hàng đợi theo địa bàn (ba tab Cần làm/Của tôi/Tất cả), chi tiết vị trí, người phụ trách, hành động tiếp theo và timeline audit.

## Phản ánh

State machine:

```text
submitted → received → assigned → verifying → processing → resolved → closed
                    ↘ rejected ─────────────────────────────────────→ closed
```

Mỗi phản ánh có `clientRequestId` chống tạo trùng, receipt dạng `PA-*`, geometry
PostGIS, địa bàn/service area, người phụ trách và status history chỉ ghi nối tiếp.
Người dân chỉ đọc hồ sơ gắn với mock identity của mình.

## SOS local

State machine:

```text
triggered → dispatched → acknowledged → responding → resolved → closed
                 ↘ escalated ↗                 ↘ responding (mở lại)
                 ↘ cancelled_by_citizen
```

App bắt buộc chọn loại tình huống, có vị trí, xác nhận môi trường local và kiểm tra
lần cuối trước khi tạo. `idempotencyKey` chống gửi lặp. Workspace CSKV yêu cầu ghi
chú ở mọi lần chuyển trạng thái; `resolved`/`closed` có xác nhận nội tuyến hai bước.

`dispatched` chỉ có nghĩa bản ghi đã vào hàng đợi local. Hệ thống hiện không có
kết nối điều phối tới 112/113, VNeID, roster trực ban chính thức, SMS/Web Push hoặc
hệ thống nghiệp vụ của Công an.

## API chính

Citizen, header `x-citizen-id`:

- `POST/GET /v1/citizen/incidents`
- `GET /v1/citizen/incidents/:receiptCode`
- `POST/GET /v1/citizen/sos`
- `POST /v1/citizen/sos/:receiptCode/cancel`

Officer, header `x-officer-id`:

- `GET /v1/officer/queue`
- `GET /v1/officer/actors`
- `GET /v1/officer/incidents/:id`
- `POST /v1/officer/incidents/:id/transitions`
- `GET /v1/officer/sos/:id`
- `POST /v1/officer/sos/:id/transitions`

Response meta luôn trả `workflowMode=local_sandbox` và
`emergencyDispatchConnected=false`.

## Kiểm thử bắt buộc trước pilot

Đã có test tự động cho idempotency, cô lập hồ sơ giữa công dân, transition không
hợp lệ, hàng đợi SOS và acknowledgement. E2E đã kiểm tra luồng người dân → CSKV →
timeline người dân trên 320 px, 375 px, landscape 667×375 và desktop 1440 px.

Trước production vẫn bắt buộc có VNeID/identity thật, RBAC/SSO, roster và SOP được
phê duyệt, rate limit, object storage cho media, notification worker, monitoring
24/7, backup/restore, diễn tập mất mạng/GPS sai/chuyển tuyến và kiểm thử ATTT.
