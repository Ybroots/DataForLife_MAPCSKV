# CSKV platform

Nền tảng web được tách khỏi ứng dụng Expo hiện tại. Web chỉ gọi API; Firestore là
nguồn migration tạm thời và không được truy cập trực tiếp từ browser.

## Thành phần

- `data-migration`: đọc Firestore + `map34.json`, chuẩn hóa hotline/đơn vị/KCN và
  lập kế hoạch migration. Chỉ ghi PostGIS khi truyền `--apply`.
- `database`: schema canonical PostGIS.
- `api`: API tra cứu địa bàn và workflow phản ánh/SOS có audit.
- `web`: app người dân map-first và workspace xử lý dành cho CSKV.

Quy tắc ánh xạ và các ngoại lệ dữ liệu được ghi tại
[`docs/canonical-data.md`](docs/canonical-data.md).

Kế hoạch tích hợp sáu tính năng, kiến trúc đích, lộ trình 16 tuần và backlog
10 ngày đầu được ghi tại
[`docs/six-feature-integration-plan.md`](docs/six-feature-integration-plan.md).

PostGIS giữ nguyên ranh giới canonical để đối chiếu không gian. API dùng hình học
đầy đủ cho `ST_Covers`, nhưng giản lược một bản sao khi trả GeoJSON cho trình
duyệt nhằm giảm payload mà không làm thay đổi kết quả xác định địa bàn.

Xuân Hương - Đà Lạt có thêm lớp `service_areas` gồm 5 ranh Phường 1, 2, 3, 4 và
10 cũ. Đây là ranh lịch sử được tái dựng để tham chiếu, có `is_demo = true` và
`provenance_status = reference_reconstructed`; không được dùng thay ranh phân
công CSKV đã phê duyệt. Nguồn và phương pháp được ghi tại
[`database/sources/README.md`](database/sources/README.md).

## Khởi động local

Hướng dẫn từng bước cho người mới nhận repo nằm ở [`../README.md`](../README.md). Tóm tắt:

```powershell
Copy-Item .env.example .env        # rồi sửa mật khẩu/secret trong .env
npm ci
docker compose up -d postgres
npm run db:setup-demo              # dựng CSDL demo (địa bàn Xuân Hương 24781)
npm run dev:api
npm run dev:web
```

> `npm run db:migrate` chỉ dành cho bản sao dữ liệu thật: migration `004` cắt ranh giới
> theo dữ liệu thật của phường nên báo lỗi trên CSDL trống. Người mới dùng `db:setup-demo`.

API mặc định dùng PostGIS. Để kiểm thử UI bằng dữ liệu minh họa, đặt
`API_DATA_SOURCE=fixture` trước khi chạy API hoặc dùng `npm --workspace
@cskv/api run dev:fixture`. File `.env` ở thư mục `platform` được API và công cụ
migration tự nạp.

Seed dữ liệu minh họa vào PostGIS (chỉ dành cho local):

```powershell
Get-Content database/seed/fixture.sql | docker compose exec -T postgres psql -U cskv -d cskv
```

Các endpoint của vertical slice:

- `GET /v1/areas?query=...`
- `GET /v1/lookup/by-code/:code`
- `GET /v1/lookup/by-location?lat=...&lng=...`
- `GET /v1/hotlines`
- `POST /v1/auth/citizen/register` — tạo tài khoản người dân bằng số điện thoại,
  họ tên và mật khẩu; mật khẩu chỉ lưu dưới dạng băm scrypt có salt.
- `POST /v1/auth/citizen/login`
- `POST /v1/auth/officer/login`

Tài khoản cán bộ được cấp phát bằng công cụ riêng; mật khẩu sinh ngẫu nhiên chỉ
được ghi vào tệp tuyệt đối nằm ngoài repository, với quyền đọc của chủ sở hữu:

```powershell
npm --workspace @cskv/api run accounts:provision-officers -- --credentials-output=C:\secure\dataforlife-officers.txt
```

Công cụ mặc định tạo `canbo01` đến `canbo05` cho địa bàn thí điểm mã `24781`,
không xoay mật khẩu của tài khoản đã tồn tại. VNeID chính thức chưa được kết nối
và giao diện phải luôn ghi rõ giới hạn này.

Các bề mặt local:

- App người dân: `http://127.0.0.1:5173/`
- Workspace CSKV: `http://127.0.0.1:5173/?portal=police`

Workflow local dùng mock identity qua header, nhưng dữ liệu được lưu vào PostGIS,
có idempotency key, phân giải địa bàn, lịch sử chuyển trạng thái và audit/outbox.
Danh sách endpoint, state machine và giới hạn an toàn được ghi tại
[`docs/local-operational-workflows.md`](docs/local-operational-workflows.md).

> SOS local **không kết nối** tổng đài 112/113 và không được trình bày như yêu cầu
> đã chuyển tới lực lượng chức năng. Nút gọi 112/113 chỉ mở trình gọi điện của thiết bị.

Hai endpoint lookup trả thêm `serviceAreas`; lookup theo tọa độ đánh dấu đúng
một vùng bằng thuộc tính `selected` nếu điểm nằm trong 5 ranh tham chiếu.

## Migration an toàn

Dry-run mặc định:

```powershell
npm run data:plan
```

Lệnh chỉ đọc Firestore, thống kê thay đổi và không ghi database. Chỉ chạy apply
sau khi đã sao lưu và kiểm tra kế hoạch:

```powershell
npm --workspace @cskv/data-migration run apply -- --confirm canonical-v1
```

Importer dùng transaction và upsert theo `source_system/source_id`; không xóa
collection Firestore.
