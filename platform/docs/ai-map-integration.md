# Trợ lý AI trên bản đồ

## Phạm vi

Tích hợp ở bản local. Chưa chọn nhà cung cấp/model hoặc cấu hình API key; chưa xác minh một lượt gọi AI thật và chưa phát hành lên VPS.

- Mở bằng nút Trợ lý ở thanh đầu trang hoặc mục Trợ lý AI trong menu.
- Hỏi bằng tiếng Việt về xã/phường Lâm Đồng, trụ sở, danh bạ, hotline và cảnh báo công khai.
- AI phân tích yêu cầu thành intent và các mã tham chiếu. Server chỉ chấp nhận mã có trong dữ liệu nguồn rồi lấy thông tin trực tiếp từ repository đang chạy.
- Danh mục lấy từ toàn bộ overview, không giới hạn ở 30 kết quả tìm kiếm. Không thay dữ liệu Postgres bằng fixture khi thiếu dữ liệu.
- Nút Xem trên bản đồ dùng mã địa bàn để gọi luồng tra cứu/ràng buộc ranh giới hiện có. AI không tự tạo tọa độ hoặc điều khiển GPS.
- Không thực thi SQL, gửi SOS, tạo phản ánh, phân công cán bộ hoặc sửa dữ liệu.
- Chưa hỗ trợ tìm trụ sở gần nhất, phân tích tội phạm, tra hồ sơ riêng tư hoặc tư vấn thủ tục pháp luật. Các tích hợp VNeID/tổng đài/SMS/push giữ trạng thái hiện có.

## Cấu hình server

Trong môi trường của API, đặt `AI_PROVIDER=openai` hoặc `AI_PROVIDER=gemini`, `AI_MODEL` bằng ID model hỗ trợ structured JSON output và key tương ứng `OPENAI_API_KEY` hoặc `GEMINI_API_KEY`. Không có model mặc định, không tự chọn dịch vụ tính phí.

Các biến chỉ đọc trong `api/src/server.ts`; tuyệt đối không thêm tiền tố `VITE_` cho key, commit `.env` hoặc đưa key vào trình duyệt/chat. Ví dụ tên biến có trong `platform/.env.example`.

`GET /v1/assistant/status` chỉ xác nhận **đã cấu hình**, không khẳng định provider đang hoạt động hoặc key còn hạn mức. Thiếu cấu hình: trợ lý chạy ở chế độ tra cứu theo tên (`createKeywordPlanner`, không gọi dịch vụ ngoài, `meta.provider = "keyword"`, giao diện ghi "chưa dùng AI"). Provider lỗi, từ chối, trả dữ liệu không hợp lệ hoặc hết `AI_DAILY_REQUEST_LIMIT`: máy chủ trả lời bằng cùng cách tra cứu theo tên và ghi rõ nguồn, không bao giờ giả làm câu trả lời của AI.

API adapters sử dụng structured outputs theo tài liệu chính thức: [OpenAI Responses](https://developers.openai.com/api/docs/guides/structured-outputs), [Gemini generateContent](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig). Không thêm SDK bên thứ ba.

## Ranh giới dữ liệu và hạn mức

- Chỉ gửi câu hỏi hiện tại, mã địa bàn đang xem, tên/mã địa bàn và nhãn/ID hotline tới provider. Không gửi boundary, GPS, mật khẩu, phiên đăng nhập, danh bạ người dân hoặc hồ sơ vụ việc. Thông tin liên hệ công khai được lấy sau khi AI trả mã, không gửi số điện thoại trong context.
- Có thông báo gửi câu hỏi tới provider ngay cạnh ô nhập; nhắc không nhập thông tin cá nhân. Không tự gửi câu hỏi khi mở trợ lý hoặc bấm gợi ý.
- Không lưu câu hỏi/lịch sử vào database hoặc localStorage. Tối đa 6 lượt hiển thị trong bộ nhớ; đóng trợ lý kết thúc lịch sử. OpenAI gọi với `store:false`; chính sách lưu giữ của nhà cung cấp vẫn cần được chủ hệ thống xem xét trước khi bật production.
- Câu hỏi 3–600 ký tự, body tối đa 4096 byte, tối đa 3 địa bàn và 8 hotline mỗi lượt. Mã ngoài danh mục bị từ chối, không dùng tọa độ do model trả về.
- Timeout provider 15 giây; tối đa 3 lượt xử lý đồng thời; 6 yêu cầu/phút/IP; `AI_DAILY_REQUEST_LIMIT` mặc định 200 lượt/ngày UTC cho mỗi tiến trình. Bộ đếm nằm trong bộ nhớ, reset khi restart; đây không phải hạn mức thanh toán cứng. Nếu chạy nhiều worker/instance phải dùng quota dùng chung và đặt thêm ngân sách tại provider.
- API query và status có `Cache-Control:no-store`. Không chuyển lỗi thô của provider hoặc key cho client/log.
- Mobile dùng một sheet; mở tùy chọn bản đồ hoặc tìm kiếm sẽ đóng trợ lý. Kết quả mở địa bàn dùng ranh giới nguồn, không đổi địa bàn thành vị trí GPS của người dùng.

## Kiểm thử và phát hành

`npm run typecheck`, `npm test`, `npm run build` từ `platform`.

`api/test/map-assistant.test.ts` kiểm tra dữ liệu nguồn, đủ danh mục 124 mục kiểm thử, output model không tin cậy, giới hạn, lỗi provider, cả hai adapter HTTP và tình trạng chưa cấu hình. Các lượt AI trong test được mock rõ ràng, không phải bằng chứng model thật hiểu đúng tiếng Việt.

`e2e/map_assistant_ui.py` chạy bản production build với API fixture riêng trên loopback; kiểm tra thiếu cấu hình, mock kết quả AI, điều hướng bản đồ, lỗi, giới hạn, mobile/desktop và worker/tile thật. Không dùng test này để khẳng định production đủ dữ liệu.

Trước phát hành: cấu hình key an toàn, kiểm tra model với bộ câu hỏi thực tế (tên trùng, sai dấu, địa bàn không tồn tại, câu hỏi ngoài phạm vi, prompt injection và khẩn cấp), kiểm tra đầy đủ dữ liệu/luồng guest–citizen–officer và thực hiện toàn bộ release gate trong `AGENTS.md`. Không triển khai fixture hoặc test SOS/sự cố lên production.

### Kết quả kiểm chứng local — 22/10/2026

- Nền Git `5fdaf45` cùng thay đổi chưa commit; giữ nguyên các thay đổi có sẵn của người dùng.
- Typecheck đạt; 53/53 unit test đạt, gồm 23 bài cho trợ lý; production build và kiểm tra MapLibre worker đạt. Cảnh báo map chunk ~964 KB có từ trước vẫn còn.
- Browser production build đạt ở 320×740, 375×812, 844×390 và 1440×900, không có page error hoặc tràn ngang. Tile thật có HTTP 200 ở cả bốn kích thước.
- Kiểm tra trạng thái thiếu cấu hình qua API thật; kết quả AI, lỗi 503 và giới hạn 429 dùng route mock được ghi rõ trong bài test. Điều hướng kết quả, Escape, khôi phục focus, context địa bàn và đóng trợ lý khi mở công cụ bản đồ đều đạt.
- Kiểm tra giữ nguyên phần tử canvas và lớp overview khi mở/đóng trợ lý; đã sửa callback không ổn định gây khởi tạo lại bản đồ. Đã xem ảnh mobile/desktop/landscape; SOS vẫn thấy khi mở sheet.
- Bằng chứng browser: `platform/test-results/map-assistant/result.json` và các ảnh PNG cùng thư mục (artifacts local được Git ignore).
- Không gọi provider thật, không nhập dữ liệu, không sửa database và không deploy trong lượt tích hợp này. Chưa đủ điều kiện khẳng định AI live hoặc production parity.
