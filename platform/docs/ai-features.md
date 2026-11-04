# AI hỗ trợ điền phiếu, nhóm phản ánh trùng, gợi ý lĩnh vực, đánh giá và chỉ số

Ứng với mục 4 (nhóm 5), mục 6 và mục 9.2 của bản mô tả giải pháp. AI chỉ gợi ý: người dân xem lại trước khi gửi,
cán bộ quyết định lĩnh vực và việc gộp hồ sơ.

## Bật trên máy chủ

Cần migration `database/migrations/014_intelligence_and_ratings.sql` (chạy lại nhiều lần vẫn an toàn) và các biến môi
trường đã có trong `.env.example`:

```
AI_PROVIDER=gemini
AI_MODEL=<tên mô hình, ví dụ gemini-3.5-flash-lite>
GEMINI_API_KEY=<khóa gói trả phí, chỉ đặt trên máy chủ>
AI_DAILY_REQUEST_LIMIT=200
```

Thiếu một trong ba biến đầu thì `GET /v1/ai/status` trả `configured: false`: giao diện ẩn ô "Kể lại sự việc" và
khối gợi ý AI ghi "AI chưa được bật". Nhóm trùng, đánh giá và chỉ số vẫn chạy vì không cần AI.

## Chức năng

| Chức năng | Ai dùng | Cách làm |
| --- | --- | --- |
| Kể lại sự việc, AI điền giúp | Người dân (đã đăng nhập) | Gõ hoặc nói (Chrome/Edge; WebView Android thường không có nhận giọng nói). AI trả nhóm, tiêu đề, thời điểm, địa điểm theo lời kể; điền sẵn vào phiếu. Vị trí bản đồ, ảnh và ô xác nhận người dân tự làm. Chặn dãy 12 chữ số trước khi gửi AI; câu khẩn cấp hiện nút gọi 113. |
| Nhóm phản ánh trùng | Cán bộ | Khi tiếp nhận, hệ thống tìm phản ánh cùng địa bàn trong 500 m và 12 giờ; điểm = khoảng cách 35% + thời gian 20% + cùng lĩnh vực 15% + nội dung 30%. Khác lĩnh vực phải giống nội dung ≥ 20%. Điểm ≥ 0,7: "Rất có thể trùng" và gợi ý trên hàng đợi. Cán bộ bấm "Gộp vào …" hoặc bỏ gộp; mỗi lần ghi nhật ký. |
| AI gợi ý lĩnh vực và đọc ảnh | Cán bộ | Bấm "Nhờ AI gợi ý": gửi nội dung và tối đa 3 ảnh của người dân (≤ 4 MB). AI trả lĩnh vực, độ tin cậy, một câu căn cứ và nhãn ảnh từ danh sách cố định (lửa khói, tai nạn, đám đông…). Cán bộ áp dụng hoặc giữ; quyết định được lưu để đo độ chính xác. Không lưu ảnh hay nội dung gửi AI. |
| AI soạn nháp phản hồi | Cán bộ | Trong mục "Trao đổi với người dân", bấm "AI soạn nháp": AI đọc nội dung phản ánh và vài tin nhắn gần nhất, điền nháp 2–5 câu và gợi ý có cần xin thêm ảnh/video. Chỉ điền vào ô soạn; cán bộ đọc, sửa rồi tự bấm gửi. Che dãy 12 chữ số trước khi gửi AI; không hứa kết quả hay thời hạn. |
| Hỏi đáp thủ tục | Người dân (công khai) | Trong Trợ lý bản đồ: khớp từ khóa trước (miễn phí), không khớp thì AI chỉ chọn mã thủ tục trong danh sách cố định. Nội dung hiển thị luôn lấy từ kho `api/src/procedures.ts`, kèm nguồn, ngày rà soát và nhắc xác nhận với Công an xã/phường. Hiện có 3 mục: đăng ký tạm trú, khai báo tạm vắng, thẻ căn cước. Lệ phí và thời hạn không ghi cứng vì thay đổi theo thời kỳ. Thêm mục mới: bổ sung vào `PROCEDURES` sau khi cơ quan duyệt. Bản tiếng Anh do AI dịch từ kho, dịch một lần rồi nhớ; lỗi thì hiện tiếng Việt. |
| Đọc ảnh khi gửi phiếu | Người dân (đã đăng nhập) | "Điền giúp tôi" gửi kèm ảnh đã chọn trong phiếu (JPG/PNG/WebP ≤ 4 MB, kiểm chữ ký tệp). Có thể chỉ gửi ảnh, không cần lời kể. AI được dặn không nhận dạng người, không đọc biển số hay số giấy tờ. |
| Gợi ý người phụ trách | Cán bộ | Hồ sơ chưa có người nhận hiện "Gợi ý: …" cạnh mục Phụ trách: cán bộ cùng địa bàn đang giữ ít hồ sơ mở nhất. Theo quy tắc, không dùng AI; hệ thống không tự chuyển hồ sơ, người được gợi ý tự nhận. |
| Dịch nội dung Việt-Anh | Người dân, cán bộ (đã đăng nhập) | Giao diện tiếng Anh: nút "Translate to English" dưới tin nhắn của cán bộ. Cán bộ: nút "Dịch sang tiếng Việt" dưới tin nhắn người dân nếu không có dấu tiếng Việt. Bản gốc giữ nguyên, bản dịch ghi rõ là tự động. Cùng một nội dung chỉ dịch một lần. |
| AI viết nhận xét báo cáo | Cán bộ | Tab Báo cáo: "AI viết nhận xét" từ số liệu tổng hợp của kỳ (không gửi nội dung phản ánh). AI không tự tính phần trăm; số nào trong nhận xét không có trong dữ liệu thì hiện cảnh báo để cán bộ đối chiếu. |
| Đánh giá sau SOS, đánh giá ứng dụng | Người dân | Mục Đánh giá: chọn phản ánh hoặc SOS đã xử lý xong, chấm 1–5; đánh giá ứng dụng 1–5 (chấm lại được). Phiếu SOS đã xử lý cũng có ô chấm nhanh. |
| Bộ chỉ số mục 9.2 | Cán bộ | Tab Báo cáo: tài khoản, thiết bị nhận thông báo, thời gian phản hồi đầu tiên, thời gian xác nhận SOS, tỷ lệ được phản hồi, số phản ánh đã gộp, VNeID (chưa kết nối), tỷ lệ gợi ý AI được giữ, điểm hài lòng. |

Ngưỡng 500 m, 12 giờ, 0,7 và 20% là đề xuất cho thí điểm, chỉnh trong `api/src/incident-intelligence.ts` sau khi có số liệu thật.

## Giới hạn hiện tại

- Chưa gọi thử Gemini thật: test dùng mô hình giả trả JSON đúng định dạng. Cần chạy bộ câu hỏi thử trước khi mở cho người dân.
- Chỉ số "tỷ lệ du khách/dân cư" chưa thu thập; "phản ánh có VNeID" luôn là chưa kết nối.
- Chưa ghi lại khi cán bộ bỏ qua một gợi ý trùng, nên chưa đo được độ chính xác của gợi ý trùng.
