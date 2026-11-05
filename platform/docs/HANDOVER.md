# Bàn giao: hiểu và làm tiếp hệ thống Bản đồ số CSKV

Tài liệu cho người nhận tiếp dự án. Đọc cùng [`../../README.md`](../../README.md) (chạy thử local) và các tài liệu
trong thư mục `docs/` (liệt kê ở cuối). Không có mật khẩu hay khóa nào trong tài liệu này.

## 1. Hệ thống là gì, đang chạy ở đâu

- Bản đồ số cho **Công an phường Xuân Hương - Đà Lạt (mã địa bàn 24781)**, thuộc Công an tỉnh Lâm Đồng. Người dân tra cứu địa bàn,
  gửi **phản ánh** (kèm ảnh, video), gửi **SOS**, xem **cảnh báo** khu vực. Cán bộ nhận và xử lý trên **cổng cán bộ**. **Chỉ huy** xem toàn phường.
- Bản chạy thật: https://bandosocskv.com, trên một VPS (nginx, API Node cổng 3001 do `systemd` chạy với tên `dataforlife-api`, PostgreSQL + PostGIS).
- Git có hai remote chính: `origin` (`Ybroots/DataForLife_MAPCSKV`, nhánh `dataforlife`) và `deploy` (`Ybroots/dataforlife_LD`, nhánh `cskv-YYYYMMDD`).
  VPS **tự kéo mã** từ `deploy`; người dùng tự `git push`, không có CI.

## 2. Cấu trúc repo

| Đường dẫn | Nội dung |
|---|---|
| `platform/api` | Fastify + PostgreSQL/PostGIS. Mỗi tệp `*-routes.ts` là một nhóm tuyến; `postgres-workflows.ts` và `operational-extensions.ts` là nơi chứa truy vấn nghiệp vụ; `fixture-repository.ts` là bản bộ nhớ dùng cho test |
| `platform/web` | React + MapLibre. `src/components` có cả giao diện người dân và cổng cán bộ (`PolicePortal.tsx`, `CommanderAreaPanel.tsx`...). `android-native` và `scripts/build-android.ps1` đóng gói Capacitor |
| `platform/database` | `migrations/001…024`, dữ liệu mẫu, công cụ sinh khu vực |
| `platform/ops` | nginx, systemd, sao lưu, **`deploy-update.sh`** |
| `platform/docs` | Tài liệu nghiệp vụ và vận hành |
| gốc repo (`App.tsx`, `src/`, `app.json`) | Ứng dụng Expo cũ, **không dùng nữa**; chỉ `map34.json` còn được platform dùng. Có thể xóa phần Expo khi chủ dự án đồng ý |

## 3. Các luồng chính

- **Phản ánh**: người dân gửi → hệ thống xác định địa bàn và **khu vực** theo tọa độ (`resolveLocation`) → vào hàng đợi của cán bộ khu vực →
  cán bộ nhận, nhắn người dân, xử lý, đóng. Người dân đánh giá sao sau khi đóng. Không cho đóng thẳng hồ sơ chưa nhận.
- **SOS**: bắt buộc có số điện thoại gọi lại (lấy từ tài khoản người dân). Tiêu đề hiển thị `SOS - tên - SĐT`. Màn hình đỏ toàn màn hình và còi hú ở mọi cán bộ
  đang mở cổng cho đến khi có người nhận. Nút "Gọi lại" tắt còi.
- **Cảnh báo**: cán bộ phát hành, hiển thị đến khi chính cán bộ gỡ (không có thời hạn; xem `manualAlertEnd`).
- **Thông báo đẩy**: `push.ts`. Nội dung cho người dân và cán bộ không chứa mã hồ sơ.
- **Trợ lý ảo** (bản đồ) và phân tích ảnh/lĩnh vực: `map-assistant.ts`, `incident-intelligence.ts`, bật bằng biến môi trường nhà cung cấp AI. Giao diện không dùng chữ "AI".

## 4. Vai trò và phân quyền theo khu vực (phần dễ làm sai nhất)

- `workflow_actors.actor_type`: `officer` (cán bộ khu vực) hoặc `supervisor` (chỉ huy, **chỉ xem**, mọi thao tác ghi bị từ chối).
- `workflow_actors.service_area_id` (migration 021): khu vực cán bộ phụ trách. NULL nghĩa là thấy cả phường. Chỉ huy luôn NULL.
- Hồ sơ/SOS có `service_area_id` do `resolveLocation` gán lúc gửi. Điều kiện gán: khu vực **đã xác minh ranh giới** *hoặc* **đã có cán bộ phụ trách**
  (migration 024 thêm vế sau). Lý do: ranh giới Xuân Hương vẫn là dữ liệu trình diễn (`is_demo = true`). Điểm nằm đúng trên ranh giới hai khu vực, hoặc khu vực chưa có cán bộ, thì hồ sơ **không có khu vực**
  và chỉ chỉ huy hoặc cán bộ chưa gắn khu vực thấy.
- Server lọc hàng đợi, thông báo, thống kê, đẩy theo khu vực. **Bản đồ, cảnh báo, điểm bản đồ chỉ lọc ở client** (`web/src/area-scope.ts`), chưa có
  kiểm tra ràng buộc phía server cho phần này.
- Ánh xạ cán bộ ↔ khu vực trong migration 021 là **dữ liệu minh họa** (danh sách phân công theo tổ dân phố chưa có bảng đối chiếu với khu vực). Khi có phân công chính thức, sửa `service_area_id`, không phải đổi mã.

## 5. Cơ sở dữ liệu và migration

- Migration đánh số `001`–`024`, **chạy lại nhiều lần an toàn**. `db:setup-demo` dựng CSDL demo mới; `db:migrate` chỉ cho bản sao dữ liệu thật.
- `ops/deploy-update.sh` áp dụng `015`–`019` và `02x`. **Bản trong `/root` trên VPS phải được chép từ repo** (`cp platform/ops/deploy-update.sh /root/`) mỗi khi script đổi; bản cũ chỉ áp tới `020`
  và đã từng làm thiếu cột `service_area_id` (đăng nhập cán bộ trả 500).
- Nếu nghi ngờ thiếu migration: `psql "$DB_URL" -f platform/database/migrations/0NN_….sql` (lấy `DATABASE_URL` từ `platform/.env`).
- Dữ liệu 124 địa bàn thật **không nằm trong repo**; bản demo chỉ có Xuân Hương. Xem `AGENTS.md` về yêu cầu đồng nhất khi đưa lên môi trường thật.

## 6. Tài khoản

- Cán bộ: `canbo01`–`canbo05` (gắn khu vực P.1, P.2, P.3, P.4, P.10), chỉ huy: `chihuy01`. Tạo bằng
  `npm run accounts:provision-officers -- --credentials-output=<đường dẫn tuyệt đối ngoài repo>` (chạy trên VPS, từ `platform/api`). Công cụ **bỏ qua** tài khoản đã có và không đổi mật khẩu.
- Quên mật khẩu cán bộ: không có công cụ riêng; đặt lại bằng một lệnh `UPDATE officer_accounts SET password_hash = …` với `hashPassword` của `api/src/password.ts`
  (mật khẩu sinh ngẫu nhiên nên chọn ký tự không dễ nhầm như `1/l/I`, `0/O`).
- Người dân tự đăng ký bằng số điện thoại; tên đăng nhập chính là số điện thoại.
- **Không bao giờ commit** mật khẩu, tệp `.env`, `google-services.json` hay khóa FCM.
- Giới hạn thử sai: nginx chặn khoảng 10 lần/phút mỗi IP ở tuyến đăng nhập (trả 429, thông điệp "thao tác quá nhanh"); API còn khóa riêng sau 5 lần sai cho cặp tài khoản + IP.
  Nhiều máy cùng một mạng dùng chung một IP nên dễ chạm giới hạn khi thử nhiều lần.

## 7. Quy ước giao diện và câu chữ

- Người dân **không thấy mã phản ánh/SOS** (chỉ cán bộ cần mã để tra cứu). Dùng nội dung phản ánh và thời gian để nhận biết hồ sơ.
- Không viết chữ "AI" trong giao diện; trợ lý bản đồ gọi là **Trợ lý ảo**. Thuật ngữ cán bộ: "Cổng cán bộ", tab "Hàng đợi / Bản đồ / Nghiệp vụ (hoặc Khu vực với chỉ huy)", trạng thái SOS "Mới phát tín hiệu" / "Chờ cán bộ nhận".
- Giao diện cán bộ chỉ có tiếng Việt. Bản dịch tiếng Anh ở `web/src/i18n-en.ts` chỉ cho phần người dân; test `i18n.test.ts` cấm đưa chữ của cổng cán bộ vào bảng này, và mọi mẫu `{0}` phải giữ nguyên số tham số.
- Tên khu vực là "Khu vực Phường N" (không có chữ "cũ").

## 8. Chạy, kiểm thử, phát hành

```powershell
cd platform
npm ci
npm run typecheck                 # web, test web và api
npm --workspace @cskv/api test    # 148 test qua, một số test cần Postgres thật sẽ tự bỏ qua
npm --workspace @cskv/web test    # 110 test qua
```
- Test cần Postgres (`pg-workflows`, `pg-intelligence`) chỉ chạy khi có CSDL thử (xem `postgres-integration-test.md`). Một số tệp trong `e2e/` còn nhắc tới tab đã bỏ (Tuần tra, Cuối ca): cần cập nhật trước khi dùng lại.
- Phát hành: trên máy Windows `git push origin dataforlife` và `git push deploy HEAD:cskv-YYYYMMDD`; trên VPS (root)
  `bash /root/deploy-update.sh cskv-YYYYMMDD <mã commit 40 ký tự>`. Script sao lưu, kéo mã (chỉ fast-forward), typecheck, test, build, áp migration, khởi động lại API, đăng web, kiểm tra.
- APK (PowerShell, trong `platform\web`): `.\scripts\build-android.ps1` (người dân) và `... -Officer` (cán bộ). Kết quả trong `platform\android-artifacts`. Bản cán bộ chỉ nhận thông báo đẩy khi có `google-services.json` đúng gói `com.bandosocskv.officer`.
- Lỗi 500 của API ghi ra journal: `journalctl -u dataforlife-api` (tuyến, mã lỗi, thông điệp).

## 9. Hạn chế và việc nên làm tiếp

1. Ràng buộc khu vực cho bản đồ, cảnh báo, điểm bản đồ ở phía server (hiện chỉ client).
2. Thay ranh giới khu vực trình diễn bằng ranh giới được phê duyệt, và phân công cán bộ thật theo tổ dân phố (hiện minh họa; chưa quyết định đổi Cao Đức Thanh sang P.1 và Vũ Tuấn Huy sang P.4).
3. Các tuyến API đã bỏ khỏi giao diện nhưng còn trong mã: tuần tra, giao ca, cấp lại mật khẩu người dân do cán bộ. Có thể xóa.
4. Phiên đăng nhập là cookie ký HMAC; danh sách thu hồi phiên nằm trong bộ nhớ nên mất khi khởi động lại API.
5. Kết nối thật: 112/113, SMS, VNeID, camera địa bàn chưa có; giao diện phải luôn ghi rõ là chưa kết nối.
6. Dọn mã Expo cũ ở gốc repo.

## 10. Bài học đã gặp (tránh lặp lại)

- Thiếu migration trên VPS làm đăng nhập 500 mà không có log (logger Fastify tắt): giờ lỗi 500 đã được ghi ra journal. Sau mỗi lần deploy, kiểm tra các migration mới đã chạy.
- Hồ sơ gửi từ khu vực chưa có cán bộ hoặc đúng trên ranh giới không có khu vực: cán bộ khu vực không thấy.
- Mật khẩu sinh ngẫu nhiên dễ bị gõ nhầm; copy-dán, đừng gõ tay, đừng chụp màn hình gửi qua chat.
- Máy phát triển Windows và máy khác có thể không dùng chung `node_modules`; chạy `npm ci` trên đúng máy.

## 11. Tài liệu tham khảo (`platform/docs`)

`commander-role.md` (chỉ huy, phân quyền, migration 021–024), `officer-case-flow.md` (luồng xử lý hồ sơ), `support-flow.md` (SOS), `operations.md` (vận hành),
`android-release.md` (APK, phát hành, VPS), `push-notifications.md`, `citizen-notifications.md`, `password-recovery.md`, `canonical-data.md` (dữ liệu chuẩn),
`pilot-areas-demo.md`, `six-feature-integration-plan.md`, `feature-status.md`, `api-structure.md`, `security-load-test.md`, `ban-do-so-cskv-uxui/` (thiết kế UX).
