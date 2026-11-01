# Cấu trúc mã API (`platform/api/src`)

`buildApp` (`app.ts`) chỉ ghép các nhóm route. Mỗi nhóm route nằm trong một module riêng, nhận cùng một `RouteContext`
(kho dữ liệu, tùy chọn, cách nhận diện người gửi, cổng tắt workflow) từ `route-context.ts`.

| Module | Nội dung | Cần đăng nhập |
| --- | --- | --- |
| `public-routes.ts` | Địa bàn, tra cứu theo mã hoặc vị trí, danh bạ, cảnh báo công khai, vùng có người trực | Không |
| `auth-routes.ts` | Đăng nhập, đăng ký, phiên, đăng xuất của cán bộ và người dân; giới hạn thử sai | Một phần |
| `citizen-routes.ts` | Phản ánh, SOS, trao đổi, minh chứng, đánh giá, thông báo của người dân | Người dân |
| `officer-case-routes.ts` | Hàng đợi, xử lý phản ánh và SOS, trao đổi, minh chứng, chuyển trạng thái | Cán bộ |
| `officer-operations-routes.ts` | Thông báo, cảnh báo công khai, tuần tra, báo cáo ca, thống kê, điểm bản đồ | Cán bộ |
| `push-routes.ts` | Đăng ký thiết bị nhận thông báo đẩy (xem `push-notifications.md`) | Tùy chọn |
| `map-assistant-routes.ts` | Trợ lý AI trên bản đồ (xem `ai-map-integration.md`) | Không |

`request-parsing.ts` là nơi duy nhất đọc và kiểm tra dữ liệu đầu vào (độ dài chuỗi, tọa độ, số điện thoại, tệp đính kèm,
thời gian). Route chỉ chọn mã lỗi và thông báo khi hàm trả `null` hoặc `undefined`.

## Thêm một route mới

1. Đặt route vào module cùng nhóm, hoặc tạo module `*-routes.ts` mới và gọi nó trong `buildApp`.
2. Route cán bộ dùng `officerIdentity(request)` rồi trả 401 `OFFICER_SESSION_REQUIRED` khi thiếu; route người dân dùng
   `citizenIdentity(request)` và 401 `CITIZEN_SESSION_REQUIRED`. Cả hai đều khai báo `preHandler: workflowDisabled`.
3. Đường dẫn bắt đầu bằng `/v1/officer/` hoặc `/v1/citizen/` sẽ được `test/route-guards.test.ts` kiểm tra tự động:
   chưa đăng nhập phải 401, tắt workflow phải 503. Test đọc các file `*-routes.ts`, nên route mới nằm trong file có hậu tố này.

## Kiểm tra sau khi tách (01/11/2026)

Trước và sau khi tách `app.ts`, cùng một bộ 690 yêu cầu (59 route, ba loại người gọi, ba loại nội dung, bật và tắt workflow)
cho ra mã trạng thái và mã lỗi giống hệt nhau; danh sách route và cổng `workflowDisabled` của từng route không đổi.
