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
| Đánh giá sau SOS, đánh giá ứng dụng | Người dân | Mục Đánh giá: chọn phản ánh hoặc SOS đã xử lý xong, chấm 1–5; đánh giá ứng dụng 1–5 (chấm lại được). Phiếu SOS đã xử lý cũng có ô chấm nhanh. |
| Bộ chỉ số mục 9.2 | Cán bộ | Tab Báo cáo: tài khoản, thiết bị nhận thông báo, thời gian phản hồi đầu tiên, thời gian xác nhận SOS, tỷ lệ được phản hồi, số phản ánh đã gộp, VNeID (chưa kết nối), tỷ lệ gợi ý AI được giữ, điểm hài lòng. |

Ngưỡng 500 m, 12 giờ, 0,7 và 20% là đề xuất cho thí điểm, chỉnh trong `api/src/incident-intelligence.ts` sau khi có số liệu thật.

## Giới hạn hiện tại

- Chưa gọi thử Gemini thật: test dùng mô hình giả trả JSON đúng định dạng. Cần chạy bộ câu hỏi thử trước khi mở cho người dân.
- Chỉ số "tỷ lệ du khách/dân cư" chưa thu thập; "phản ánh có VNeID" luôn là chưa kết nối.
- Chưa ghi lại khi cán bộ bỏ qua một gợi ý trùng, nên chưa đo được độ chính xác của gợi ý trùng.
