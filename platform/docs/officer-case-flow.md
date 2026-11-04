# Luồng xử lý hồ sơ của cán bộ

Ngày chốt: 2026-11-01. Màn hình chi tiết hồ sơ chỉ hiện **một việc chính** theo trạng thái; các việc hiếm gặp nằm trong mục "Việc khác".
Mã nguồn: `web/src/case-actions.ts` (bảng việc theo trạng thái), `web/src/components/CaseActionCard.tsx` (thẻ việc cần làm).
Máy chủ vẫn là nơi quyết định chuyển trạng thái nào hợp lệ (`api/src/workflow.ts`); web chỉ chọn nút để hiện. Test `web/test/case-actions.test.ts` kiểm tra mọi nút đều là chuỗi chuyển hợp lệ theo đúng sơ đồ của máy chủ.

## Phản ánh

| Trạng thái | Việc chính | Việc khác |
| --- | --- | --- |
| Chờ tiếp nhận | **Nhận hồ sơ** (tiếp nhận rồi tự nhận phụ trách, một lần bấm) | Đóng, không xử lý |
| Đã tiếp nhận | **Nhận xử lý** | Không thuộc phạm vi; Đóng, không xử lý |
| Đã phân công | **Bắt đầu xử lý** | Cần xác minh thêm; Không thuộc phạm vi |
| Đang xác minh | **Chuyển sang xử lý** | Không thuộc phạm vi |
| Đang xử lý | **Đã xử lý xong** (bắt buộc ghi kết quả, ít nhất 20 ký tự) | Không thuộc phạm vi |
| Đã có kết quả | **Đóng hồ sơ** (bấm hai lần) | Mở lại để xử lý tiếp |
| Không thuộc phạm vi | **Đóng hồ sơ** (bấm hai lần) | |

## SOS

| Trạng thái | Việc chính | Việc khác |
| --- | --- | --- |
| Chờ cán bộ nhận | **Nhận SOS ngay** (gửi sẵn lời nhắn "đã nhận tín hiệu, đang liên hệ") | Chuyển đơn vị khác phối hợp; Người dân đã hủy |
| Đã xác nhận | **Đang đến hiện trường** | Đã xử lý xong; Chuyển đơn vị khác |
| Đang triển khai | **Đã xử lý xong** (ghi kết quả, ít nhất 20 ký tự) | Chuyển đơn vị khác |
| Đã chuyển tuyến | **Nhận lại SOS** | Đang đến hiện trường |
| Đã xử lý xong | **Đóng SOS** (bấm hai lần) | Mở lại để xử lý tiếp |

## Quy tắc

- Việc không cần viết (nhận, bắt đầu xử lý, đóng) dùng một câu chuẩn của hệ thống. Cán bộ có thể bấm "Nhắn người dân" để viết riêng.
- Việc cần viết (xử lý xong, không thuộc phạm vi, chuyển đơn vị, mở lại) hiện ô ghi chú ngay. Ô "Cho người dân đọc nội dung này" mặc định bật với kết quả và lý do ngoài phạm vi, tắt với các việc còn lại.
- Việc nối nhiều bước (nhận hồ sơ mới = tiếp nhận + phân công) gọi lần lượt từng chuyển trạng thái hợp lệ, mỗi bước vẫn ghi vào lịch sử. Người dân nhận hai thông báo trạng thái cùng lúc.
- Việc không hoàn tác được (đóng hồ sơ, đóng SOS, ghi nhận người dân hủy) cần bấm lần hai.
- Chỉ một cán bộ đang đăng nhập nên chưa có bước chọn người phụ trách; máy chủ vẫn từ chối giao cho người khác.

## Màn hình cổng cán bộ (đợt 2, gọn hơn)

- Thanh trên có ba mục có chữ: **Hàng đợi** (kèm số việc cần làm), **Bản đồ**, **Nghiệp vụ**; bên phải là nút **Còi bật/tắt** và đăng xuất. Trên điện thoại dùng thanh dưới.
- Hàng đợi chỉ có ô tìm kiếm và ba tab: **Cần làm**, **Của tôi**, **Tất cả** (kèm số lượng). Không còn bộ lọc nhiều tầng, dải số liệu hay chuông riêng.
- Mỗi thẻ hồ sơ chỉ có tiêu đề, một nhãn trạng thái, thời gian (đỏ khi quá hạn) và gợi ý "Có thể trùng". Phản ánh có ảnh hiện **ảnh thu nhỏ** ngay trên thẻ (kèm "+n" nếu nhiều ảnh); ảnh chỉ tải khi thẻ cuộn tới.
- Máy chủ trả thêm `previewAttachmentId` và `photoCount` cho từng phản ánh trong hàng đợi (ảnh đầu tiên người dân gửi, ưu tiên ảnh ban đầu).
- Ảnh minh chứng luôn hiện trong hồ sơ; phần trao đổi với người dân thu gọn trong mục "Trao đổi với người dân".
