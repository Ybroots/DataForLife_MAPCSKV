# Lấy lại mật khẩu tài khoản người dân (mã khôi phục)

> **Trạng thái: đã bật trong giao diện** (mặc định). Cần máy chủ đã chạy migration 015-017 để đầy đủ; email cần thêm cấu hình SMTP
> (chưa có thì giao diện ghi rõ "chưa kết nối" và vẫn dùng được mã khôi phục). Tắt tạm: build với `VITE_PASSWORD_RECOVERY=false`
> (giao diện khi đó chỉ hiện thông báo "đang phát triển"). Cờ nằm ở `web/src/password-recovery.ts`.
> Đăng ký có ô email (không bắt buộc): nhập email thì nhận mã 6 số để xác minh ngay sau bước lưu mã khôi phục.

Tài khoản người dân dùng **số điện thoại + mật khẩu**. Hệ thống chưa xác minh số điện thoại (chưa có SMS) và chưa kết nối VNeID,
nên cách lấy lại mật khẩu hiện tại là **mã khôi phục** do chính người dân giữ.

## Các cách lấy lại mật khẩu

| Cách | Ai làm | Cần gì |
| --- | --- | --- |
| **Qua email** (tự phục vụ) | Người dân | Đã thêm và xác minh email trong Tài khoản; máy chủ đã cấu hình SMTP |
| **Mã khôi phục** | Người dân | Mã đã lưu khi đăng ký |
| **Cán bộ cấp mã** | Cán bộ + người dân | Chỉ khi mất cả hai cách trên |

Cán bộ chỉ là phương án cuối; hai cách đầu người dân tự làm, không cần ai xử lý.

### Qua email

1. Người dân đăng nhập → **Tài khoản → Email khôi phục mật khẩu** → nhập email và mật khẩu hiện tại → nhận mã 6 số → nhập mã để xác minh email.
2. Quên mật khẩu: **Quên mật khẩu? → Qua email** → nhập số điện thoại → nhận mã 6 số (hiệu lực 15 phút) → nhập mã và mật khẩu mới.
3. Phản hồi bước gửi mã luôn giống nhau dù số điện thoại có tài khoản hay không (không lộ ai đã đăng ký); thư chỉ gửi tới email **đã xác minh**.
   Việc tra cứu và gửi thư chạy sau khi đã trả lời, nên thời gian phản hồi không tiết lộ điều đó.
4. Mỗi mã dùng một lần, tối đa 5 lần nhập sai (sai quá thì phải gửi mã mới); gửi tối đa 3 mã/giờ cho mỗi số điện thoại và 10 mã/giờ cho mỗi IP.
   Đặt lại thành công đăng xuất các máy khác.

## Cách hoạt động của mã khôi phục

- Khi đăng ký, máy chủ cấp một mã dạng `ABCD-EFGH-JKMN-PQRS` (16 ký tự, bỏ chữ dễ nhầm I, L, O và số 0, 1). Mã **chỉ hiện đúng một lần** trong phản hồi đăng ký.
  CSDL chỉ lưu bản băm scrypt (cột `citizen_accounts.recovery_code_hash`), không lưu mã gốc.
- Tài khoản tạo trước đây chưa có mã: đăng nhập, vào **Tài khoản → Mã khôi phục mật khẩu**, nhập mật khẩu hiện tại để tạo mã.
  Tạo lại thì mã cũ hết hiệu lực.
- Quên mật khẩu: màn đăng nhập có nút **Quên mật khẩu?** → nhập số điện thoại, mã khôi phục và mật khẩu mới.
  Mã **dùng một lần**: đặt lại thành công thì máy chủ cấp mã mới (hiện một lần) và mã cũ vô hiệu.
- Đặt lại thành công đăng xuất mọi phiên cũ của tài khoản đó.
- **Mất cả mã khôi phục:** người dân đến Công an khu vực (hoặc gọi điện). Cán bộ xác minh danh tính rồi vào cổng cán bộ → **Nghiệp vụ → Tài khoản dân**,
  nhập số điện thoại, tick xác nhận đã kiểm tra danh tính và bấm **Cấp mã đặt lại**. Mã (cùng định dạng, hiệu lực 24 giờ, dùng một lần) chỉ hiện một lần cho cán bộ;
  cán bộ đưa mã cho người dân, người dân nhập ở màn **Quên mật khẩu?** như mã khôi phục. Sau khi đặt lại, người dân nhận mã khôi phục mới.

## API

| Phương thức | Đường dẫn | Ghi chú |
| --- | --- | --- |
| POST | `/v1/auth/citizen/register` | Phản hồi 201 có thêm `data.recoveryCode` (nếu CSDL đã chạy migration 015). |
| POST | `/v1/auth/citizen/recovery-code` | Cần đăng nhập + `{ currentPassword }`. Trả `{ data: { recoveryCode } }`. |
| POST | `/v1/auth/citizen/forgot-password` | `{ username, recoveryCode, newPassword }`. Chấp nhận mã khôi phục hoặc mã do cán bộ cấp (còn hạn). Thành công trả `{ data: { recoveryCode } }` (mã mới). |
| GET | `/v1/auth/citizen/recovery-options` | Công khai. `{ data: { email: boolean } }`: email có kết nối chưa (giao diện ẩn/ghi rõ nếu chưa). |
| GET | `/v1/auth/citizen/email` | Cần đăng nhập. `{ available, email (đã che), verified }`. |
| POST | `/v1/auth/citizen/email` | Cần đăng nhập. `{ email, currentPassword }` → gửi mã xác minh (202). |
| POST | `/v1/auth/citizen/email/verify` | Cần đăng nhập. `{ code }` → xác minh email. |
| POST | `/v1/auth/citizen/forgot-password/email` | `{ username }` → gửi mã đặt lại tới email đã xác minh. Luôn 202. |
| POST | `/v1/auth/citizen/forgot-password/email-confirm` | `{ username, code, newPassword }` → đặt lại mật khẩu. |
| POST | `/v1/officer/citizen-accounts/reset-code` | Cần đăng nhập cán bộ. `{ phone, verified: true }` (bắt buộc xác nhận đã kiểm tra danh tính). 201 trả `{ recoveryCode, expiresAt, displayName, phone }`. |

## Bảo mật

- Sai số điện thoại, tài khoản chưa có mã hay sai mã đều trả cùng một lỗi `RECOVERY_FAILED` và tốn thời gian xử lý như nhau (không lộ số điện thoại nào đã có tài khoản).
- Giới hạn thử sai theo cặp IP + số điện thoại (5 lần/15 phút) và theo IP; bộ đếm tách riêng với đăng nhập thường.
- Mật khẩu mới theo cùng quy tắc đăng ký (từ 10 ký tự, gồm chữ và số).
- Đổi mã khôi phục và mật khẩu trong một câu lệnh chỉ khi mã cũ chưa bị đổi (chặn dùng một mã hai lần khi gửi song song).
- Thu hồi phiên lưu **trong bộ nhớ của tiến trình API** (giống bộ giới hạn đăng nhập): phiên chỉ sống tối đa 12 giờ và ghi nhận thu hồi mất khi máy chủ khởi động lại.
- Mã do cán bộ cấp: tối đa 20 mã/cán bộ/24 giờ, hiệu lực 24 giờ, dùng một lần, chỉ lưu bản băm. Mỗi lần cấp và mỗi lần dùng được ghi vào bảng `citizen_account_events`
  (kèm mã cán bộ). Hiện mọi cán bộ đăng nhập đều cấp được; nếu muốn chỉ cho chỉ huy cấp thì thêm kiểm tra vai trò ở route này.
- Tài khoản cấu hình bằng biến môi trường (`API_CITIZEN_*`) không có mã khôi phục; đổi mật khẩu ở máy chủ.

## Cấu hình email

Máy chủ gửi thư bằng SMTP (bộ gửi tự viết trong `api/src/mailer.ts`, không thêm thư viện). Đặt trong `platform/.env`:

```
API_SMTP_HOST=smtp.gmail.com
API_SMTP_PORT=465            # 465 (TLS ngay) hoặc 587 (STARTTLS)
API_SMTP_USER=ten-tai-khoan@gmail.com
API_SMTP_PASSWORD=mat-khau-ung-dung
API_MAIL_FROM=Bản đồ số Cảnh sát khu vực <ten-tai-khoan@gmail.com>
```

- Gmail: bật xác minh 2 bước rồi tạo **Mật khẩu ứng dụng**; hạn mức gửi hằng ngày của Gmail thấp, nên dùng nhà cung cấp email giao dịch (SendGrid, Brevo, Amazon SES, email doanh nghiệp) cho bản chạy thật.
- Bộ gửi từ chối SMTP không mã hóa tới máy khác (mã xác minh không đi qua mạng ở dạng rõ). Chứng chỉ TLS được kiểm tra; chỉ khi thử với chứng chỉ tự ký mới đặt `API_SMTP_TLS_REJECT_UNAUTHORIZED=false`.
- Chưa đặt `API_SMTP_HOST` thì email **chưa kết nối**: API trả `EMAIL_NOT_CONFIGURED`, giao diện ghi rõ và vẫn dùng được mã khôi phục.
- Thử trên máy cá nhân không cần SMTP: đặt `API_MAIL_TRANSPORT=console`, nội dung thư (có mã 6 số) được in ra console của API. Tùy chọn này bị bỏ qua khi `NODE_ENV=production`.
- Dòng khởi động của API cho biết trạng thái: `email off`, `email smtp` hoặc `email console`.
- Email là dữ liệu cá nhân: được lưu trong `citizen_accounts.email`, chỉ hiện dạng che (`ab***@gmail.com`) và không dùng vào việc nào khác ngoài mã xác minh và đặt lại mật khẩu.

## Triển khai

1. Sao lưu CSDL như các lần phát hành trước.
2. Chạy lần lượt migration `015_citizen_recovery_codes.sql`, `016_citizen_assisted_reset.sql` rồi `017_citizen_email_recovery.sql` (an toàn khi chạy lại, chỉ thêm cột và bảng nhật ký). **Chạy trước khi bật API mới.**
   Nếu chưa chạy 015: đăng ký và đăng nhập vẫn hoạt động (không có mã); `recovery-code` và `forgot-password` trả 503 `RECOVERY_UNAVAILABLE`.
   Nếu đã chạy 015 mà chưa chạy 016: mã khôi phục tự giữ vẫn dùng được; cấp mã bởi cán bộ trả 503 `RESET_UNAVAILABLE`.
   Nếu chưa chạy 017: email báo `RECOVERY_UNAVAILABLE`/không đọc được; các cách còn lại vẫn dùng được.
3. Build lại API và web (APK build lại bằng `npm run android:apk`).

## Chưa làm

- Mã OTP qua SMS/Zalo ZNS: cần nhà cung cấp và xác minh số điện thoại lúc đăng ký; chưa kết nối.
- Bộ gửi SMTP đã được kiểm thử với máy chủ SMTP giả (thường, TLS ngay, STARTTLS, AUTH PLAIN/LOGIN) nhưng chưa thử với máy chủ email thật (Gmail, SendGrid...). Thử gửi một thư thật trước khi phát hành.
- Phần SQL của migration 015, 016, 017 và các hàm mã khôi phục / cấp lại trong `postgres-repository.ts` chưa được chạy thử trên PostgreSQL thật; luồng đã được kiểm thử đầy đủ với kho dữ liệu giả lập.
