# Bản đồ số Cảnh sát khu vực (DataForLife / CSKV)

Ứng dụng bản đồ số phục vụ người dân và cán bộ Công an khu vực: tra cứu địa bàn, danh bạ và hotline,
cảnh báo khu vực, phản ánh kèm ảnh/video và nhập bằng giọng nói, SOS, trợ lý bản đồ AI, cổng nghiệp vụ cho cán bộ
(hàng đợi, lưu trữ hồ sơ đã đóng, báo cáo xuất CSV/PDF) và ứng dụng Android cho người dân.
Trang chạy thật: https://bandosocskv.com (dự án của Công an tỉnh Lâm Đồng).

## Repo gồm gì

| Thư mục | Nội dung |
|---|---|
| [`platform/`](platform/) | **Sản phẩm chính**: `api` (Fastify + PostgreSQL/PostGIS), `web` (React + MapLibre, kèm Capacitor Android), `database`, `ops`, `docs`, `e2e` |
| gốc repo (`App.tsx`, `src/`, `app.json`, `map34.json`…) | Ứng dụng Expo danh bạ cũ và dữ liệu ranh giới `map34.json`. Platform dùng `map34.json`, còn app Expo cũ không cần để chạy platform |

## Chạy thử trên máy (khoảng 10 phút)

Cần: **Node.js 20 trở lên**, **Docker** (cho PostgreSQL + PostGIS), Git.

```powershell
git clone <địa-chỉ-repo>
cd <thư-mục-repo>\platform
Copy-Item .env.example .env
```

Mở `platform/.env` và **đặt mật khẩu/secret của riêng bạn** (các dòng `API_*_SESSION_SECRET` tối thiểu 32 ký tự,
`API_OFFICER_PASSWORD`, `API_CITIZEN_PASSWORD`). Sau đó:

```powershell
npm ci
docker compose up -d postgres        # CSDL cổng 5434, tài khoản cskv/cskv_local (chỉ để chạy local)
npm run db:setup-demo                # dựng dữ liệu DEMO: địa bàn Xuân Hương - Đà Lạt (mã 24781)
npm run dev:api                      # API  http://127.0.0.1:3001
npm run dev:web                      # Web  http://127.0.0.1:5173
```

- Người dân: http://127.0.0.1:5173/ , đăng nhập bằng `API_CITIZEN_USERNAME`/`API_CITIZEN_PASSWORD` hoặc tự đăng ký.
- Cán bộ: http://127.0.0.1:5173/?portal=police , đăng nhập bằng `API_OFFICER_USERNAME`/`API_OFFICER_PASSWORD`.
- Không có Docker? Đặt `API_DATA_SOURCE=fixture` trong `.env` và chạy `npm run dev:api`: dữ liệu minh họa trong bộ nhớ, không cần CSDL.

**Dữ liệu đầy đủ 124 địa bàn không nằm trong repo.** Bản demo chỉ có địa bàn Xuân Hương. Dữ liệu thật được nhập bằng công cụ
`platform/data-migration` từ Firestore + `map34.json` (xem [`platform/docs/canonical-data.md`](platform/docs/canonical-data.md));
việc này cần cấu hình Firebase của bạn trong `.env` và chỉ chạy `--apply` sau khi sao lưu.

## Kiểm thử và build

```powershell
cd platform
npm run typecheck
npm test                      # web + api + data-migration (test dùng PostgreSQL bị bỏ qua nếu không đặt TEST_DB_URL)
npm run build -w @cskv/api    # api/dist
npm run build -w @cskv/web    # web/dist
```

Kiểm thử trên PostgreSQL thật: [`platform/docs/postgres-integration-test.md`](platform/docs/postgres-integration-test.md).
Kiểm thử tải/bảo mật (chỉ chạy trên máy local): [`platform/docs/security-load-test.md`](platform/docs/security-load-test.md).

## Ứng dụng Android (APK)

Cần Android Studio (JDK + SDK), chạy trên Windows PowerShell:

```powershell
cd platform
npm ci
cd web
npm run android:apk            # ra platform\android-artifacts\ban-do-cskv-preview.apk
```

- Mặc định APK gọi API `https://bandosocskv.com/api`. Dùng máy chủ của bạn: `$env:CSKV_API_URL = 'https://tên-miền-của-bạn/api'` trước khi build.
- Thông báo đẩy (FCM) chỉ bật khi có `platform/web/android-native/app/google-services.json` của dự án Firebase của bạn ([`docs/push-notifications.md`](platform/docs/push-notifications.md)).
- Bản phát hành cần khóa ký riêng, **không commit khóa**: xem [`platform/docs/android-release.md`](platform/docs/android-release.md).
- Nhập giọng nói cần quyền micro và dịch vụ giọng nói của Google trên máy.

## Triển khai lên máy chủ (VPS)

Mô hình đang chạy: nginx phục vụ `web/dist` ở `/var/www/dataforlife`, API chạy bằng systemd (`dataforlife-api`) từ `api/dist/server.js`, PostgreSQL/PostGIS.
Các file mẫu nằm trong [`platform/ops/`](platform/ops/): cấu hình nginx, sao lưu hằng ngày, kiểm tra sức khỏe, gia hạn chứng chỉ; xem [`platform/docs/operations.md`](platform/docs/operations.md).

Cập nhật một bản phát hành (không có migration mới):

```bash
/usr/local/sbin/dataforlife-backup           # sao lưu trước
cd /opt/dataforlife/repo && git pull
cd platform && npm ci
npm run build -w @cskv/api && npm run build -w @cskv/web
rsync -a --delete web/dist/ /var/www/dataforlife/
systemctl restart dataforlife-api
curl -s https://<tên-miền>/api/health
```

Đường dẫn và tên dịch vụ trên là của máy chủ hiện tại; đổi theo máy chủ của bạn.

## Bảo mật khi chia sẻ repo

- `platform/.env` đã nằm trong `.gitignore`. Không commit `.env`, `google-services.json`, khóa ký `.jks`/`keystore.properties`, tệp mật khẩu tài khoản cán bộ.
- Mật khẩu cán bộ do công cụ `accounts:provision-officers` sinh ngẫu nhiên và ghi ra tệp **ngoài** repo ([`platform/README.md`](platform/README.md)).
- Khóa AI (`OPENAI_API_KEY`/`GEMINI_API_KEY`) và khóa FCM chỉ đặt trên máy chủ API, không bao giờ dùng tiền tố `VITE_`.
- Cảnh báo: file `app.json` và `src/config/firebase.local.ts` của **app Expo cũ** ở gốc repo có chứa khóa Google Maps/Firebase.
  Hãy hạn chế khóa theo ứng dụng/miền trong Google Cloud Console (hoặc tạo khóa mới) trước khi công khai repo.

## Tài liệu

Các tài liệu trong [`platform/docs/`](platform/docs/): kiến trúc API (`api-structure.md`), quy trình xử lý hồ sơ (`officer-case-flow.md`),
luồng cục bộ (`local-operational-workflows.md`), trợ lý AI (`ai-features.md`), thông báo đẩy, vận hành và các bản phát hành.
