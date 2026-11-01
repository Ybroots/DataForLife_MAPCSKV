# Kiểm thử tải và an ninh (01/11/2026)

Phạm vi: chỉ chạy trên API + PostgreSQL cục bộ (máy 2 nhân, 8 GB). **Không** chạy vào bandosocskv.com. Các script nằm ở `e2e/security_sweep.cjs` và `e2e/load_citizens.cjs`, tự từ chối địa chỉ không phải localhost.

## 1. Tải (người dân vào cùng lúc)

API đọc công khai (GET), 10 giây mỗi mức, 100 và 500 kết nối đồng thời, 0 lỗi:

| Endpoint | 100 kết nối | 500 kết nối |
|---|---|---|
| /health | 22.384 req/s | 22.215 req/s |
| /v1/areas?query= | 4.876 req/s, p99 50 ms | 4.284 req/s, p99 206 ms |
| /v1/hotlines | 3.982 req/s | 4.197 req/s |
| /v1/areas/overview (dữ liệu thử 381 B) | 3.057 req/s | 3.295 req/s |
| /v1/lookup/by-location (truy vấn PostGIS) | 810 req/s, p50 119 ms | 818 req/s, p50 592 ms |

Hành trình đầy đủ của người dân (tra cứu → đăng ký → đăng nhập → gửi phản ánh kèm ảnh 300 KB → xem lại): 300 người cùng lúc và 1.000 người (150 đồng thời), **0 lỗi**.

- Nút thắt duy nhất là băm mật khẩu (scrypt, ~53 ms/lần): khi 300 người đăng ký cùng một giây thì đăng ký p95 ≈ 8 s. Đã thêm hàng đợi giới hạn (4 phép chạy cùng lúc, tối đa 300 chờ, quá thì trả 503 "hệ thống bận" kèm Retry-After); sửa luôn lỗi quá tải bị báo nhầm thành "sai mật khẩu".
- `lookup/by-location` là truy vấn nặng nhất (~800 req/s); đủ cho vài nghìn người dùng GPS cùng lúc, cân nhắc bộ nhớ đệm theo ô lưới nếu cần hơn.
- Dữ liệu ranh giới thật ~1 MiB; trên VPS đã bật gzip và `Cache-Control: public, max-age=300`.

## 2. An ninh (40 kiểm tra tự động trong `security_sweep.cjs`)

Đạt: mọi route cần đăng nhập đều trả 401/403 khi không có phiên (44 route); người dân không gọi được route cán bộ và ngược lại; IDOR (người dân B không xem/nhắn/rút/đánh giá/tải ảnh của A, SOS cũng vậy); cookie bị sửa, header giả danh (`x-citizen-id`…) không có tác dụng; khóa đăng nhập sau 5 lần sai, giới hạn đăng ký theo IP, giới hạn spam SOS; CORS không mở cho origin lạ; cookie HttpOnly + SameSite=Lax; SQLi/XSS/path traversal không gây lỗi; gửi lại cùng `clientRequestId` không tạo bản sao.

## 3. Lỗi tìm thấy và đã vá

| # | Lỗi | Cách vá |
|---|---|---|
| 1 | JSON hỏng, body rỗng, sai Content-Type, `__proto__` trong body → **500** | Trả 400/415 rõ ràng (`app.ts`, error handler) |
| 2 | Body > 30 MB → 500 | Trả 413 |
| 3 | Ký tự NUL (`%00`, `\u0000`) làm PostgreSQL lỗi → 500 ở nhiều route | Chặn sớm bằng hook `preValidation` (400) và map lỗi PG 22021/22P02 |
| 4 | `DELETE /v1/officer/map-points/<id sai dạng>` → 500 | Trả 404 (map lỗi PG 22P02) |
| 5 | Tải lên file HTML/script khai là PNG vẫn được nhận | Kiểm tra byte đầu (JPEG/PNG/WebP/MP4/WebM) trước khi nhận |
| 6 | Dồn đăng nhập/đăng ký từ nhiều IP có thể nghẽn CPU do scrypt | Hàng đợi băm có giới hạn, quá tải trả 503 (cấu hình `API_HASH_CONCURRENCY`, `API_HASH_QUEUE`) |
| 7 | Chỉ POST nhạy cảm mới bị nginx giới hạn; GET công khai không giới hạn | Thêm `limit_req` 10 req/s/IP (burst 120) và `limit_conn` 80/IP cho `/api/` (xem `ops/dataforlife-nginx.conf`) |
| 8 | **Thiếu endpoint** đổi mật khẩu (người dân và cán bộ) và không có giao diện | Thêm `POST /v1/auth/citizen/change-password`, `POST /v1/auth/officer/change-password` (có khóa thử sai) và mục "Đổi mật khẩu" ở trang Tài khoản |

## 4. Còn tồn tại, cần quyết định

- **Đăng xuất không thu hồi phiên**: phiên là token ký (12 giờ người dân, 8 giờ cán bộ); token bị lộ vẫn dùng được đến khi hết hạn, kể cả sau khi đổi mật khẩu. Cách vá: cột `session_version` trên tài khoản, tăng khi đổi mật khẩu/đăng xuất và kiểm tra khi xác thực (cần migration).
- **Không có quên mật khẩu** (cần SMS/OTP); hiện chỉ đổi được khi còn nhớ mật khẩu cũ. Tài khoản cấu hình trong `.env` (kiểm thử) phải đổi ở máy chủ.
- **Giới hạn trong bộ nhớ** (đăng nhập, SOS, phản ánh, đăng ký) mất khi khởi động lại API và không chia sẻ nếu chạy nhiều tiến trình; hiện 1 tiến trình nên ổn.
- Nhiều người dùng chung một IP mạng di động (CGNAT) cùng chịu giới hạn theo IP: đăng ký 5 lần/10 phút, đăng nhập sai 30 lần/15 phút.
- `/health` lộ `releaseValidation` nếu `API_RELEASE_VALIDATION=true`; trên VPS cần để tắt (hiện `ops/api-production.conf` không bật).
- Chưa kiểm tra: DDoS tầng mạng (cần dịch vụ ngoài như Cloudflare), nginx thật (chưa chạy `nginx -t` với cấu hình mới), tải trên cấu hình VPS thật, bản Android thật.
