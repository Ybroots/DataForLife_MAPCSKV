# Android: ký bản phát hành và danh sách kiểm thử thiết bị

Cập nhật: 31/10/2026. Bổ sung cho `android-apk-feasibility.md` (phương án Capacitor + `platform/web`).

## 1. Đã làm trong lượt này

| Hạng mục | Thay đổi | Kiểm chứng |
|---|---|---|
| Lỗi mạng | `native-api.ts`: lỗi đường truyền native (mất mạng, DNS, timeout) trả về `TypeError` như `fetch()`, giữ `cause`; hủy request vẫn là `AbortError` | Unit test |
| Nội dung gửi | Body không phải chuỗi (Blob/FormData) bị từ chối rõ ràng thay vì bị bỏ im lặng; body chuỗi không phải JSON gửi dạng văn bản | Unit test |
| Giới hạn tải lên | Chặn body > 30 triệu ký tự (video 20 MB base64 ≈ 26,7 triệu) với thông báo tiếng Việt | Unit test |
| Nút Back | `closeTopOverlay`: đóng hộp thoại `role=dialog aria-modal` trên cùng (kể cả khi nút đóng nằm ở lớp phủ bên cạnh), rồi tới các panel cũ; không còn gì mới thoát/thu nhỏ app | Unit test (DOM giả) |
| Cấu hình Capacitor | Bỏ `Keyboard.resizeOnFullScreen` (plugin SystemBars cảnh báo gây lỗi bố cục); thêm `SystemBars.insetsHandling=css`, `initialViewportFitValueHint=cover` (khớp `viewport-fit=cover` trong `index.html`) | Đọc mã nguồn plugin; chưa chạy trên máy |
| Ký bản phát hành | `app/build.gradle` đọc `android-native/keystore.properties` (không commit); `assembleRelease`/`bundleRelease` báo lỗi nếu thiếu khóa; `versionCode`/`versionName` đặt qua `-PcskvVersionCode`/`-PcskvVersionName` | **Chưa chạy Gradle** (máy phát triển không có Android SDK trong phiên này) |
| Script | `build-android.ps1 -Release -VersionCode N -VersionName X` tạo APK + AAB kèm SHA-256; không cho phép kết hợp với `-Qa` | **Chưa chạy** |

Kết quả chạy: `tsc -b` sạch; `tsc -p test/tsconfig.json` sạch; `vitest` 30/30 đạt; `vite build --mode android` thành công và `verify-map-worker.mjs` xác nhận worker MapLibre có trong gói.

## 2. Điều đã xác minh bằng đọc mã nguồn Capacitor 8.6.0 (chưa phải bằng thiết bị)

- `CapacitorCookies.load()` gọi `CookieHandler.setDefault(...)` **không phụ thuộc** cờ `enabled` (cờ này chỉ điều khiển việc patch phía JS). Vì vậy `CapacitorHttp.request` chạy qua `HttpURLConnection` dùng chung cookie manager gắn với `android.webkit.CookieManager`.
- API đặt cookie với `Max-Age` (công dân 12 giờ, cán bộ 8 giờ), nên phiên không bị `removeSessionCookies()` xóa khi mở lại app.
- Plugin SystemBars tự cộng viền hệ thống vào WebView hoặc chuyển cho `env(safe-area-inset-*)`; CSS hiện có dùng `env()` nên không cần đổi.

Cả ba điểm vẫn phải được chứng minh trên thiết bị (mục 4): đọc mã chỉ cho biết thiết kế, không cho biết hành vi của WebView/ROM cụ thể.

## 3. Tạo khóa ký và build bản phát hành

Khóa ký do chủ dự án giữ; không tạo thay, không commit, không dùng khóa debug để phát hành. Mất khóa nghĩa là không thể cập nhật đè bản đã cài.

```powershell
# Một lần duy nhất, chạy trên máy chủ dự án. Sao lưu file .jks và mật khẩu ở nơi an toàn riêng.
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore D:\keys\bandosocskv-release.jks -alias cskv -keyalg RSA -keysize 2048 -validity 10000
```

Tạo `platform/web/android-native/keystore.properties` (đã nằm trong `.gitignore`):

```properties
storeFile=D:/keys/bandosocskv-release.jks
storePassword=...
keyAlias=cskv
keyPassword=...
```

Build (trong `platform/web`):

```powershell
npm run android:apk -- -Release -VersionCode 1 -VersionName 1.0.0
```

Kết quả nằm ở `platform/android-artifacts/` (đã gitignore): `.apk` để cài trực tiếp, `.aab` để đưa lên Google Play. `VersionCode` phải tăng ở mỗi bản phát hành. Ghi lại SHA-256 và commit nguồn khi bàn giao.

## 4. Danh sách kiểm thử trên máy thật (cổng trước khi phát hành)

Dùng bản `ban-do-cskv-preview.apk` (API production, **chỉ đọc**) hoặc bản QA trên emulator với API/database tách biệt. Không tạo SOS/sự cố thử trên production.

1. **Phiên:** đăng nhập công dân → đóng hẳn app (vuốt khỏi danh sách gần đây) → mở lại: còn đăng nhập. Đăng xuất → mở lại: không còn. Lặp lại với cán bộ. Chờ hết hạn/đổi tài khoản: không lộ phiên cũ.
2. **Ảnh minh chứng:** mở tệp đính kèm bảo vệ (`getIncidentAttachmentUrl`) sau khi đăng nhập.
3. **Tải lên:** ảnh 5 MB và video 20 MB trên máy cấu hình thấp: không treo/văng app; thử mất mạng giữa chừng và thử lại (khóa idempotency của sự cố/SOS chống gửi trùng).
4. **Camera/tệp:** nút chụp ảnh (`capture=environment`) và chọn tệp mở đúng ứng dụng; từ chối quyền camera không làm app hỏng.
5. **GPS:** cấp/từ chối quyền, tắt GPS, hết thời gian chờ; vị trí khớp ranh giới nguồn.
6. **Back:** đóng lần lượt từng hộp thoại (đăng nhập, danh sách tính năng, trợ lý bản đồ, thông báo, bộ lọc); khi đang nhập phản ánh thì Back bỏ focus trước; ở màn hình gốc thì thu nhỏ app.
7. **Bàn phím & viền:** thanh trạng thái/thanh điều hướng không che nội dung (Android 15+ vẽ tràn viền); biểu mẫu không bị bàn phím che; **màu biểu tượng thanh trạng thái** đọc được trên thanh tiêu đề đỏ (nếu không, đặt `SystemBars.style` sau khi quan sát — chưa đặt vì chưa nhìn thấy kết quả thực tế).
8. **Bản đồ:** worker, tile, nhãn Hoàng Sa/Trường Sa, thu phóng, vào nền rồi mở lại, xoay màn hình.
9. **Liên kết ngoài:** `tel:` mở trình gọi (không tự gọi), chỉ đường mở Google Maps/trình duyệt.
10. **Đối chiếu dữ liệu:** `node scripts/check-mobile-backend.mjs` (chỉ đọc) phải báo 124 địa bàn, 296 liên hệ, 34 hotline.

## 5. Chưa làm / ngoài phạm vi

- Thông báo đẩy, offline đầy đủ, định vị nền: hạng mục riêng, chưa có.
- Truyền tệp native thay cho base64 trong JSON: chỉ cần nếu bước 3 cho thấy hết bộ nhớ; cần thiết kế endpoint upload mới.
- App Expo ở thư mục gốc đang được chuyển từ Firestore sang API (`src/services/apiClient.ts`, `AuthService.ts`…) là nhánh riêng, chưa kiểm thử, và không phải đường phát hành chính theo tài liệu khảo sát.
