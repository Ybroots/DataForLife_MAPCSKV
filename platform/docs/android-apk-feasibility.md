# Nghiên cứu bản Android và đóng gói APK

Ngày khảo sát: 30/10/2026. Mã nguồn tại thời điểm khảo sát: `55c8aab`.

Trạng thái: đã kiểm tra cấu trúc mã nguồn, công cụ Android trên máy và tài liệu chính thức. Đây là phương án xây dựng, chưa tạo APK, chưa kiểm thử ứng dụng Android và chưa thay đổi hệ thống production.

## 1. Kết luận

Có thể xây dựng APK từ dự án hiện tại. Đề xuất **Capacitor Android, dùng lại mã nguồn `platform/web`**, cùng API/Postgres hiện có trên VPS. Giao diện được build và đóng gói vào APK; dữ liệu nghiệp vụ và AI tiếp tục chạy trên server.

Không dùng ngay app Expo cũ làm bản phát hành tương đương website: hai phần đã khác nhau về tính năng, nguồn dữ liệu và xác thực.

Phạm vi đề xuất cho bản đầu: có Internet; bản đồ, danh bạ, tài khoản, cảnh báo, phản ánh, SOS nội bộ pilot và trợ lý AI theo trạng thái kết nối thực tế. Thông báo đẩy, offline hoàn chỉnh và định vị nền là hạng mục riêng, không được coi là tự có sau khi đóng gói.

## 2. Bằng chứng trong repository

- `package.json` ở thư mục gốc: Expo SDK 54, React Native 0.81.5. `App.tsx` chỉ tổ chức hai tab Danh bạ và Bản đồ.
- `src/services/CommuneService.ts`, `ContactService.ts`: app cũ truy cập Firestore trực tiếp; không sử dụng API Postgres hiện tại.
- `src/context/AuthContext.tsx`: trạng thái đăng nhập nằm trong React state. `src/screens/LoginScreen.tsx` có mock validation, chấp nhận đầu vào khác rỗng; không thể dùng làm xác thực production.
- `platform/web`: giao diện hiện tại, MapLibre, danh bạ, tài khoản người dân/cán bộ, phản ánh, SOS và trợ lý bản đồ.
- `platform/web/src/api.ts`: API mặc định `/api`, gọi bằng `fetch` với `credentials: include`.
- `platform/api/src/citizen-auth.ts`, `officer-auth.ts`: phiên dùng cookie `HttpOnly; SameSite=Lax`, thêm `Secure` trong production.
- `platform/ops/api-production.conf`: CORS hiện cấu hình cho `https://bandosocskv.com`.
- `platform/web/src/maplibre-runtime.ts`: worker bản đồ được Vite build riêng; phải tiếp tục đưa đầy đủ worker và các tài nguyên phụ thuộc vào APK.
- `platform/web/src/components/CitizenReportsPage.tsx`: hiện dùng input chọn ảnh/video và `capture=environment`; cần kiểm tra trên Android thực tế.
- Chưa thấy cấu hình Capacitor hoặc EAS Build trong mã nguồn được theo dõi. Việc có lệnh `expo run:android` không chứng minh đã có APK tương đương bản web.

## 3. So sánh các hướng

| Hướng | Khả năng dùng lại bản hiện tại | Công việc chính | Nhận định |
|---|---|---|---|
| Expo cũ → APK | Thấp với các chức năng mới | Chuyển Firestore sang API, làm xác thực và xây lại các luồng còn thiếu | Có thể build app cũ, nhưng chưa đáp ứng parity |
| React Native viết lại theo API hiện tại | Dùng lại backend, ít dùng lại UI | Viết lại giao diện, bản đồ, biểu mẫu và kiểm thử | Phù hợp nếu có nhu cầu native sâu dài hạn |
| **Capacitor + `platform/web`** | Cao với mã giao diện và nghiệp vụ | Bổ sung lớp Android cho phiên, GPS, tệp, Back và lifecycle | **Đề xuất cho bản Android đầu tiên** |
| PWA + Trusted Web Activity | Cao với website đã phát hành | Manifest/PWA, Digital Asset Links, ký app và cấu hình domain | Phương án thay thế nếu chỉ cần app online mở website; ít quyền điều khiển native hơn |

Capacitor hỗ trợ runtime Android và dự án Android Studio. TWA hiển thị nội dung web bằng trình duyệt và xác minh quan hệ app–website qua Digital Asset Links; không tương đương một ứng dụng native được viết lại. Nguồn: [Capacitor Android](https://capacitorjs.com/docs/android), [Chrome TWA](https://developer.chrome.com/docs/android/trusted-web-activity).

## 4. Kiến trúc đề xuất

```text
APK: giao diện React/Vite + MapLibre worker + lớp tích hợp Android
  ├─ Quyền GPS/camera, chọn tệp, Back, vòng đời ứng dụng
  └─ HTTPS → API hiện có trên VPS → Postgres/PostGIS và provider AI
```

- Giữ một nguồn giao diện/nghiệp vụ trong `platform/web`; thêm build mode Android và các adapter riêng. Không sao chép dữ liệu 124 địa bàn thành fixture độc lập trong app.
- Cấu hình API Android dùng URL HTTPS tuyệt đối. `/api` không tự trỏ đến VPS khi giao diện nằm trong APK.
- Đóng gói `webDir` từ bản Vite đã build. Không lấy `server.url=https://bandosocskv.com` làm cấu hình release Capacitor: tài liệu chính thức dành tùy chọn này cho live reload, không khuyến nghị production. [Capacitor config](https://capacitorjs.com/docs/config).
- Giữ logo, màu sắc và bố cục mobile hiện có. Chỉ sửa vùng an toàn, bàn phím, nút Back và tương tác thiết bị khi kiểm thử chứng minh cần thiết.
- Không nhúng Gemini key, mật khẩu cán bộ, `.env`, database URL hoặc session secret vào APK. AI vẫn đi qua API server.

## 5. Các điểm cần làm trước khi có bản APK dùng được

### Phiên đăng nhập — cần kiểm chứng đầu tiên

Giao diện đóng gói và API HTTPS khác origin. Không thể giả định cookie `SameSite=Lax` và `credentials: include` hiện tại sẽ hoạt động nguyên trạng trong WebView.

Prototype đầu tiên cần kiểm tra transport native HTTP và quản lý cookie cho đăng nhập, gọi API bảo vệ, tải attachment, hết hạn, đóng/mở app và đăng xuất. Không bỏ `HttpOnly`/`Secure` hoặc mở CORS `*` để làm cho đăng nhập tạm chạy được. Nếu transport native không giữ phiên đúng và an toàn, phải thiết kế xác thực mobile riêng trước khi phát hành.

Capacitor cung cấp native HTTP, có thể patch fetch/XHR, nhưng việc bảo toàn cookie và các kiểu phản hồi của **ứng dụng này** vẫn phải đo trên thiết bị. [Capacitor HTTP](https://capacitorjs.com/docs/apis/http), [Cookies](https://capacitorjs.com/docs/apis/cookies).

### Bản đồ và dữ liệu

- Kiểm tra WebGL/GPU, worker, tile, font/glyph, đổi lớp và thu/phóng trên WebView thực tế; HTTP 200 của trang không đủ.
- Đối chiếu 124 địa bàn/124 ranh giới, đầy đủ 296 liên hệ và 34 hotline theo yêu cầu nguồn của dự án; kiểm tra cả địa bàn ngoài Xuân Hương.
- Giữ nhãn Hoàng Sa/Trường Sa, nguồn bản đồ và các nhãn demo/tham chiếu. Không tạo tọa độ trụ sở còn thiếu.
- Xử lý app vào nền rồi mở lại, xoay màn hình và thiết bị cấu hình thấp. Chỉ chốt danh sách phiên bản Android hỗ trợ sau khi kiểm tra runtime bản đồ.

### GPS, ảnh/video và liên kết

- Gom các chỗ dùng browser geolocation vào adapter dùng chung: web giữ API trình duyệt, Android xin quyền rồi lấy vị trí thiết bị. Có trạng thái từ chối quyền/GPS tắt/timeout và cách thử lại.
- Bản đầu chỉ định vị khi đang sử dụng chức năng; không xin quyền theo dõi nền. Plugin Geolocation chính thức không cung cấp định vị nền trực tiếp. [Geolocation](https://capacitorjs.com/docs/apis/geolocation).
- Chọn/chụp ảnh, quay/chọn video qua cơ chế Android phù hợp; giữ giới hạn tệp của API, xem trước, hủy chọn và thông báo khi tải thất bại.
- Hiện API nhận base64; kiểm tra đỉnh bộ nhớ khi tải video 20 MB và retry. Nếu cần chuyển sang truyền tệp native, phải thiết kế endpoint/upload tương ứng; không chỉ đổi plugin là xong. Capacitor có lưu ý về chi phí truyền dữ liệu lớn qua bridge. [Large file support](https://capacitorjs.com/docs/apis/http#large-file-support).
- Liên kết điện thoại chỉ mở trình gọi, không tự gọi. Chỉ đường mở ứng dụng ngoài bằng địa chỉ/tọa độ đã xác minh. Nút Back đóng sheet trước, rồi quay lại màn hình; tránh thoát app ngay khi đang nhập phản ánh.

## 6. Công cụ trên máy đã xác minh

| Thành phần | Kết quả quan sát |
|---|---|
| Node.js | `v24.16.0` |
| Android Studio | Có cài đặt, build `252.27397.103.2522.14514259` |
| JDK đi kèm Android Studio | OpenJDK `21.0.8` |
| SDK Platforms | API 33, 34, 35, 36 |
| Build Tools | Có đến `36.1.0` |
| Command-line tools | Có thư mục `latest` |

Có nền tảng để thực hiện build local. Chưa chạy Gradle, kiểm tra đầy đủ license/cache, tạo emulator hay cài APK trên máy thật trong lượt nghiên cứu này; chưa thể coi toolchain đã vượt bài kiểm tra build.

Java trên PATH đi qua Oracle javapath; khi build nên trỏ `JAVA_HOME` của tiến trình build tới JDK đã kiểm chứng đi kèm Android Studio, không thay đổi Java toàn hệ thống. Capacitor 8 yêu cầu Node 22+ và Android Studio 2025.2.1 trở lên; cần kiểm tra lại theo phiên bản package chốt lúc triển khai. [Environment setup](https://capacitorjs.com/docs/getting-started/environment-setup).

## 7. Thứ tự triển khai và đầu ra

1. **Prototype nền:** thêm Capacitor, đóng gói build web local, kiểm tra bản đồ thật và API read-only. Chưa tạo sự cố/SOS trên production.
2. **Chốt phiên và thiết bị:** chứng minh đăng nhập/đăng xuất đúng; tích hợp GPS, camera/tệp, Back và vùng bàn phím. Đây là cổng quyết định trước khi mở rộng kiểm thử.
3. **Bản debug cài trực tiếp:** xuất APK debug, cài trên emulator và ít nhất một điện thoại thật. Kiểm tra luồng guest/citizen/officer trong môi trường dữ liệu tách biệt.
4. **Bản pilot ký số:** chốt applicationId, versionCode và khóa ký thuộc chủ dự án; tạo APK release cho phân phối nội bộ. Không dùng debug key cho phát hành chính thức.
5. **Phát hành nếu cần:** AAB là đầu ra cho Google Play; APK là đầu ra để cài trực tiếp. Đây là hai artifact khác nhau. [Expo: APK và AAB](https://docs.expo.dev/build-reference/apk/).

ApplicationId của app cũ là `com.danhbacald.app`. Muốn cập nhật đè bản đã cài phải xác minh danh tính gói, khóa ký và versionCode. Pilot có thể dùng applicationId riêng để tránh thay thế app cũ; chưa tự tạo hoặc đổi danh tính phát hành trong lượt nghiên cứu.

## 8. Điều kiện nghiệm thu APK

- Cài và mở app, cold start, vào nền/mở lại, xoay màn hình, nâng cấp phiên bản và xử lý mất mạng đều có kết quả kiểm thử.
- Có bản đồ nền/worker thực, đầy đủ dữ liệu nguồn và danh bạ; không chỉ kiểm tra trang trả 200 hoặc thấy marker.
- Guest/citizen/officer đúng phân quyền; không mất phiên bất thường, không lộ phiên giữa tài khoản, logout và hết hạn có hiệu lực.
- GPS chính xác theo quyền thiết bị và đối chiếu ranh giới nguồn; camera/tệp hoạt động trong giới hạn dung lượng.
- Phản ánh, bổ sung media, theo dõi, đánh giá và SOS được kiểm thử trên API/database riêng. Không phát sinh SOS hoặc sự cố thử trên production.
- AI, VNeID chính thức, 112/113, SMS/push giữ đúng trạng thái kết nối thực tế; đóng gói APK không làm các tích hợp này tự trở thành dịch vụ hoạt động.
- Typecheck, unit test và browser build tests đạt; thêm Android device tests. Nếu thay backend hoặc triển khai web/API, thực hiện toàn bộ release gate và sao lưu theo `AGENTS.md`.
- Bàn giao APK, SHA-256 artifact, commit nguồn, phiên bản Android/WebView đã test, bản ghi dữ liệu, cấu hình môi trường không chứa secret, khóa ký được quản lý riêng và danh sách hạn chế.

## 9. Phần chưa xác minh

Chưa có APK tạo trong lượt này; chưa kiểm tra native HTTP/cookie, GPS/camera trên thiết bị, hiệu năng GPU, cập nhật app hoặc khóa ký. Số liệu 124/296/34 là yêu cầu parity và mốc từ tài liệu dự án, không phải một lần kiểm đếm production mới ngày 30/10/2026. Tính khả thi đóng gói và khả năng phát hành đủ chức năng là hai mốc phải kiểm chứng riêng.
