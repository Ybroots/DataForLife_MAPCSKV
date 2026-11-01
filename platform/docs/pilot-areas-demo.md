# Ba địa bàn trình diễn: Xuân Hương, Xuân Trường, Lâm Viên (Đà Lạt)

Tài liệu này mô tả dữ liệu minh họa cho ba phường gần nhau của Đà Lạt, để màn hình bản đồ người dân cho thấy
cùng một kiểu thông tin ở cả ba nơi: **khu vực bên trong phường**, **pin cảnh sát khu vực (CSKV)** của từng khu,
**điểm tiếp dân** và **danh bạ**.

| Địa bàn | Mã | Số khu vực | Cách có khu vực | Số pin CSKV | Số điểm tiếp dân |
| --- | --- | ---: | --- | ---: | ---: |
| Xuân Hương - Đà Lạt | 24781 | 5 | Tái dựng từ 5 phường cũ (migration `004`) | 5 | 5 |
| Xuân Trường - Đà Lạt | 24805 | 4 | Chia minh họa theo hình học (migration `012`) | 4 | 4 |
| Lâm Viên - Đà Lạt | 24778 | 3 | Chia minh họa theo hình học (migration `012`) | 3 | 3 |

Số khu bằng số đơn vị hành chính cũ đã sáp nhập: Xuân Trường gồm 4 đơn vị (Phường 11, Xuân Thọ, Xuân Trường, Trạm Hành),
Lâm Viên gồm 3 phường cũ (8, 9, 12).

## Giới hạn quan trọng

- **Khu vực của Xuân Trường và Lâm Viên không phải ranh xã/phường cũ.** Môi trường làm việc không tải được ranh
  lịch sử (nguồn ArcGIS/GADM bị chặn), nên mỗi phường được chia bằng sơ đồ Voronoi quanh các điểm hạt giống cố định
  (tâm cụm k-means của các điểm mẫu trong ranh phường), rồi cắt theo đúng polygon phường. Các khu phủ kín ranh,
  không chồng lấn, và mang cờ `is_demo = true`. Tên khu ghi vị trí tương đối ("Khu vực 2 · Tây Bắc"), không mượn tên phường cũ.
- Giao diện tự nhận biết loại khu: khu có `legacyWardCode` hiển thị "N khu vực phường cũ", còn lại hiển thị
  "N khu vực chia minh họa" kèm ghi chú "chưa phải ranh đơn vị cũ hay ranh phân công CSKV".
- Vị trí pin CSKV và điểm tiếp dân vẫn là giả định (như Xuân Hương). Tên và số điện thoại của trụ sở/CSKV lấy từ danh bạ
  công khai của phường trong cơ sở dữ liệu; ở chế độ fixture chúng là giá trị giữ chỗ (`090 000 0000`).
- Muốn có ranh phường cũ thật cho hai phường này, mở rộng `database/tools/generate-xuan-huong-service-areas.mjs`
  (truy vấn theo `NAME_3`, không cần FID) và thay các dòng `source_system = 'pilot-demo-voronoi'`.

## Chạy thử không cần cơ sở dữ liệu

```
cd platform/api
npm run dev:fixture:pilots       # tsx watch src/server.ts --fixture --pilot-areas
```

Cần các biến môi trường như `npm run dev:fixture` (`API_OFFICER_SESSION_SECRET`, `API_OFFICER_USERNAME`, ...).
Chế độ này thay địa bàn minh họa đơn `DEMO-DA-LAT` bằng ba địa bàn thật ở trên (ranh đã đơn giản hóa, dữ liệu trong
`platform/api/fixture-data/pilot-areas.json`). Không có cờ `--pilot-areas` thì fixture giữ nguyên hành vi cũ.

## Đưa lên máy chủ thật

Máy chủ dùng PostgreSQL thật có dữ liệu nghiệp vụ, nên làm theo thứ tự của các lần phát hành trước (sao lưu, thử trên bản sao, rồi mới áp dụng).
API không cần triển khai lại: thay đổi ở `platform/api` chỉ dành cho chế độ fixture, không đụng `postgres-repository.ts`.

1. Sao lưu root-only: `pg_dump -Fc` cơ sở dữ liệu, thư mục web `/var/www/dataforlife` và file env.
2. Thử trên bản sao: tạo cơ sở dữ liệu tạm từ bản dump, chạy `psql -v ON_ERROR_STOP=1 -f database/migrations/012_pilot_demo_zones.sql`,
   rồi kiểm tra có 4 khu `XT-K*` và 3 khu `LV-K*`. Không dùng `npm run db:migrate` trên máy chủ thật: lệnh này chạy lại toàn bộ
   migration từ `001`, trong khi chỉ cần `012`.
3. Áp dụng `012` trên cơ sở dữ liệu thật (địa bàn `24805` và `24778` phải đã được nạp; nếu chưa, migration chỉ in thông báo và bỏ qua).
   Migration an toàn khi chạy lại (`ON CONFLICT (code)`) và tự kiểm tra: đúng số khu, hình học hợp lệ, hợp các khu khớp ranh phường (sai lệch tối đa 1 m²).
4. Build web (`npm run build` trong `platform/web`) và triển khai `dist` vào `/var/www/dataforlife`. Ứng dụng người dân hiện pin CSKV cho cả ba mã `24781`, `24805`, `24778`.
5. Nginx đang cache `/v1/areas/overview` và API trả cache công khai 5 phút: dữ liệu khu vực có thể chậm tối đa vài phút mới xuất hiện.
   Khu vực nằm trong `/v1/lookup/...`, không thuộc overview.
6. Kiểm tra: mở `?area=24805` và `?area=24778`, thấy 4 và 3 khu; Xuân Hương vẫn 5 khu; số địa bàn, liên hệ, hotline và số phản ánh/SOS không đổi.

Hoàn tác: các dòng thêm có `source_system = 'pilot-demo-voronoi'`, xóa bằng `DELETE FROM service_areas WHERE source_system = 'pilot-demo-voronoi';`.

**Chưa được kiểm thử:** migration `012` chưa chạy trên PostgreSQL/PostGIS (môi trường làm việc không có PostGIS). Hãy chạy
trên bản sao dữ liệu trước. Hình học tương ứng đã được dựng và kiểm tra topology bằng Shapely (lệch 0 km², không chồng lấn).

## Kiểm thử đã chạy

- `platform/api/test/pilot-areas.test.ts`: ba địa bàn, số khu, phủ kín và không chồng lấn, mỗi khu một CSKV, tra cứu theo vị trí
  đánh dấu đúng khu, tìm kiếm theo tên/mã, chế độ mặc định không đổi.
- `platform/web/test/citizen-map-points.test.ts`: mỗi khu đúng một pin CSKV và một điểm tiếp dân nằm trong khu; pin ưu tiên
  cảnh sát khu vực; nhãn khu; kiểm tra điểm trong polygon có lỗ.
