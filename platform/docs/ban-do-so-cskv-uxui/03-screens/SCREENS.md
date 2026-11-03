# Đặc tả màn hình

Mỗi màn hình: mục đích · thành phần · quy tắc hiển thị · các trạng thái (rỗng, đang tải, lỗi, thành công…). Ảnh UI ở `png/`, ảnh phác thảo (wireframe) ở `png/wireframe/`. Trang HTML tương ứng có nút chuyển UI ⇄ Wireframe.

## C01 · Chào mừng / chọn cách vào

**Mục đích.** Cho người dân vào app trong 1 chạm; đăng nhập là tuỳ chọn, chỉ bắt buộc khi gửi phản ánh/SOS.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c01-chao-mung.html](c01-chao-mung.html)

**Thành phần**
- Logo + tên đơn vị
- Thẻ lựa chọn (list-item card)
- Cảnh báo mất mạng (alert warn)

**Quy tắc hiển thị**
- "Người dân" luôn là hành động đầu tiên, không bắt đăng nhập.
- Chỉ hiện cảnh báo mạng khi navigator.onLine = false.
- Bản Android citizen-only không có lối vào cán bộ.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c01-default | Mặc định | [png](png/c01-default.png) | [png](png/wireframe/c01-default.png) |
| c01-offline | Mất mạng | [png](png/c01-offline.png) | [png](png/wireframe/c01-offline.png) |

**Đi tiếp tới:** c03 (Người dân) · c02 (Đăng nhập)

---

## C02 · Đăng nhập / Đăng ký

**Mục đích.** Xác thực người dân bằng số điện thoại + mật khẩu; cũng là "cổng chặn" nhẹ khi người dân vào tính năng cần tài khoản.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c02-dang-nhap.html](c02-dang-nhap.html)

**Thành phần**
- Sheet (tờ trượt)
- Tabs 2 mục
- Field + Input + nút hiện mật khẩu
- Button primary lg
- Toast thành công

**Quy tắc hiển thị**
- Tờ trượt phủ trên nội dung hiện tại, bấm nền tối hoặc ✕ để đóng và quay về đúng chỗ.
- Lỗi hiển thị ngay dưới ô sai bằng chữ + biểu tượng (không chỉ đổi màu); số lần thử còn lại được nêu rõ.
- Nút gửi vô hiệu + spinner khi đang xử lý, chặn bấm đúp.
- Đăng ký: mật khẩu ≥ 8 ký tự; sau đăng ký tự đăng nhập.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c02-login | Đăng nhập | [png](png/c02-login.png) | [png](png/wireframe/c02-login.png) |
| c02-register | Đăng ký | [png](png/c02-register.png) | [png](png/wireframe/c02-register.png) |
| c02-gate | Bị chặn từ Phản ánh | [png](png/c02-gate.png) | [png](png/wireframe/c02-gate.png) |
| c02-error | Sai mật khẩu | [png](png/c02-error.png) | [png](png/wireframe/c02-error.png) |
| c02-loading | Đang xử lý | [png](png/c02-loading.png) | [png](png/wireframe/c02-loading.png) |
| c02-success | Thành công | [png](png/c02-success.png) | [png](png/wireframe/c02-success.png) |

**Đi tiếp tới:** c03 (thành công) · đóng → màn trước

---

## C03 · Bản đồ (trang chủ)

**Mục đích.** Điểm vào chính: nhìn thấy mình đang ở địa bàn nào, ai là CSKV phụ trách, có cảnh báo gì; có SOS trong tầm ngón cái.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c03-ban-do.html](c03-ban-do.html)

**Thành phần**
- Topbar (Trợ lý · Thông báo · Tính năng)
- Ô tìm kiếm + nút danh bạ + nút lớp bản đồ
- Bản đồ + ghim + chấm vị trí
- Thẻ tóm tắt địa bàn (bottom card)
- Nút SOS + định vị
- Tabbar 4 mục

**Quy tắc hiển thị**
- Mặc định xem toàn tỉnh; chọn địa bàn (tìm kiếm / chạm bản đồ) → hiện thẻ tóm tắt ở dưới, SOS nâng lên trên thẻ.
- Ô tìm kiếm đang hiện tên địa bàn thì nút × = bỏ chọn, về toàn tỉnh (không có ô chọn trùng trên điện thoại).
- Cảnh báo mặc định BẬT, hiển thị toàn tỉnh (không bắt chọn địa bàn).
- Nút SOS luôn hiển thị trên trang bản đồ, màu đỏ riêng, không bị che bởi thẻ.
- Lớp bản đồ mở dạng thẻ ở dưới, không che ô tìm kiếm.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c03-default | Toàn tỉnh | [png](png/c03-default.png) | [png](png/wireframe/c03-default.png) |
| c03-area | Đã chọn địa bàn | [png](png/c03-area.png) | [png](png/wireframe/c03-area.png) |
| c03-layers | Mở lớp bản đồ | [png](png/c03-layers.png) | [png](png/wireframe/c03-layers.png) |
| c03-loading | Đang tải bản đồ | [png](png/c03-loading.png) | [png](png/wireframe/c03-loading.png) |
| c03-error | Lỗi tải ranh giới | [png](png/c03-error.png) | [png](png/wireframe/c03-error.png) |

**Đi tiếp tới:** c04 (danh bạ) · c08 (SOS) · c11 (Trợ lý) · c09 (Thông báo) · c12 (Tính năng)

---

## C04 · Danh bạ địa bàn

**Mục đích.** Tìm đúng xã/phường rồi gọi / chỉ đường tới Cảnh sát khu vực và trụ sở, không cần đăng nhập.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c04-danh-ba.html](c04-danh-ba.html)

**Thành phần**
- Pagehead
- Ô tìm kiếm
- List item (chọn được)
- Thẻ chi tiết địa bàn
- Nút Gọi / Chỉ đường
- Skeleton / Empty state

**Quy tắc hiển thị**
- Gõ ≥ 2 ký tự mới gọi tìm; hiển thị "Đang tìm…" sau 300 ms.
- Danh sách mặc định = địa bàn xem gần đây (tối đa 5).
- Số điện thoại bấm được (tel:), có chữ "Gọi" kèm biểu tượng.
- Chỉ đường mở Google Maps ở tab mới; nếu thiếu toạ độ/địa chỉ → thông báo rõ lý do.
- Địa bàn chưa có cán bộ trực: gắn nhãn cảnh báo và nhắc gọi 112/113.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c04-list | Danh sách | [png](png/c04-list.png) | [png](png/wireframe/c04-list.png) |
| c04-detail | Chi tiết địa bàn | [png](png/c04-detail.png) | [png](png/wireframe/c04-detail.png) |
| c04-loading | Đang tìm | [png](png/c04-loading.png) | [png](png/wireframe/c04-loading.png) |
| c04-empty | Không có kết quả | [png](png/c04-empty.png) | [png](png/wireframe/c04-empty.png) |

**Đi tiếp tới:** c06 (Gửi phản ánh) · c03 (xem trên bản đồ)

---

## C05 · Cảnh báo khu vực

**Mục đích.** Cho người dân thấy mọi cảnh báo đang hiệu lực mà cán bộ đã phát, không cần đăng nhập.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c05-canh-bao.html](c05-canh-bao.html)

**Thành phần**
- Chip lọc theo loại
- List item + status
- Empty / Skeleton / Alert lỗi

**Quy tắc hiển thị**
- Sắp xếp mới nhất trước; cảnh báo hết hạn tự ẩn.
- Mỗi cảnh báo có loại (nhãn màu + chữ), nơi áp dụng, thời gian.
- Chạm cảnh báo → bản đồ bay tới vị trí cảnh báo.
- Không hiện số điện thoại/thông tin cá nhân người dân trong cảnh báo công khai.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c05-list | Có cảnh báo | [png](png/c05-list.png) | [png](png/wireframe/c05-list.png) |
| c05-empty | Rỗng | [png](png/c05-empty.png) | [png](png/wireframe/c05-empty.png) |
| c05-loading | Đang tải | [png](png/c05-loading.png) | [png](png/wireframe/c05-loading.png) |
| c05-error | Lỗi | [png](png/c05-error.png) | [png](png/wireframe/c05-error.png) |

**Đi tiếp tới:** c03 (xem vị trí)

---

## C06 · Gửi phản ánh

**Mục đích.** Cho người dân báo một việc trong < 1 phút, bằng gõ hoặc nói, ảnh không bắt buộc; nhận mã hồ sơ để theo dõi.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c06-gui-phan-anh.html](c06-gui-phan-anh.html)

**Thành phần**
- Pagehead
- Chip chọn loại
- Textarea + nút micro
- Nút chụp/chọn ảnh + thumbnail
- Thẻ vị trí (GPS)
- Checkbox liên hệ lại
- Button primary lg
- Alert info/warn
- Màn thành công + mã hồ sơ

**Quy tắc hiển thị**
- Bắt buộc: loại việc, nội dung ≥ 10 ký tự, vị trí. Ảnh/video tuỳ chọn.
- Chưa đăng nhập → hiện tờ trượt đăng nhập (c02) rồi quay lại, giữ nguyên nội dung đã nhập.
- Micro: chạm để nghe, chạm lần nữa để dừng; văn bản nhận dạng điền vào ô nội dung, người dùng sửa được. Trên Android dùng quyền micro của hệ thống.
- Ảnh > ~1.5 MB tự nén phía máy, không chặn giao diện; hiện spinner trên thumbnail đang xử lý.
- Mất mạng: lưu nháp, hiển thị cảnh báo vàng, nút đổi thành "Gửi lại".
- Thành công: hiện mã hồ sơ cỡ lớn, nút chính "Theo dõi hồ sơ".

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c06-empty | Mặc định | [png](png/c06-empty.png) | [png](png/wireframe/c06-empty.png) |
| c06-listening | Đang nói (micro) | [png](png/c06-listening.png) | [png](png/wireframe/c06-listening.png) |
| c06-compress | Đang nén ảnh | [png](png/c06-compress.png) | [png](png/wireframe/c06-compress.png) |
| c06-error | Thiếu nội dung | [png](png/c06-error.png) | [png](png/wireframe/c06-error.png) |
| c06-sending | Đang gửi | [png](png/c06-sending.png) | [png](png/wireframe/c06-sending.png) |
| c06-offline | Mất mạng | [png](png/c06-offline.png) | [png](png/wireframe/c06-offline.png) |
| c06-done | Thành công | [png](png/c06-done.png) | [png](png/wireframe/c06-done.png) |

**Đi tiếp tới:** c07 (theo dõi) · c02 (cần đăng nhập)

---

## C07 · Theo dõi phản ánh

**Mục đích.** Người dân biết hồ sơ của mình đang ở bước nào, ai phụ trách, cán bộ nói gì; bổ sung thông tin và đánh giá khi xong.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c07-theo-doi.html](c07-theo-doi.html)

**Thành phần**
- Tabs Đang xử lý / Đã xong
- List item + thumbnail + status
- Thẻ hồ sơ
- Timeline
- Alert tình trạng
- Textarea bổ sung
- Empty / Skeleton

**Quy tắc hiển thị**
- Trạng thái hiển thị bằng chữ dễ hiểu (“Trực ban đã tiếp nhận”), không dùng mã kỹ thuật.
- Chỉ lời nhắn cán bộ đánh dấu “cho người dân đọc” mới hiện trong timeline.
- Chỉ cho bổ sung khi hồ sơ chưa đóng; sau khi “Đã có kết quả” → hiện Đánh giá / Báo lại.
- Mỗi cập nhật gửi thông báo đẩy + chấm đỏ ở chuông.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c07-list | Danh sách | [png](png/c07-list.png) | [png](png/wireframe/c07-list.png) |
| c07-detail | Chi tiết – đang xử lý | [png](png/c07-detail.png) | [png](png/wireframe/c07-detail.png) |
| c07-done | Chi tiết – đã có kết quả | [png](png/c07-done.png) | [png](png/wireframe/c07-done.png) |
| c07-empty | Chưa có hồ sơ | [png](png/c07-empty.png) | [png](png/wireframe/c07-empty.png) |
| c07-loading | Đang tải | [png](png/c07-loading.png) | [png](png/wireframe/c07-loading.png) |

**Đi tiếp tới:** c14 (Đánh giá) · c06 (Gửi mới)

---

## C08 · SOS – cầu cứu khẩn cấp

**Mục đích.** Gửi tín hiệu cầu cứu kèm vị trí tới cán bộ trực trong ≤ 2 thao tác, chống bấm nhầm; luôn có đường gọi 113.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c08-sos.html](c08-sos.html)

**Thành phần**
- Nút SOS lớn (sos-big) + thanh tiến trình
- Thẻ vị trí/GPS
- Alert nguy hiểm/cảnh báo
- Timeline trạng thái
- Modal xác nhận hủy
- Nút gọi 113

**Quy tắc hiển thị**
- ĐỀ XUẤT: giữ 3 giây để gửi (chống chạm nhầm), thả sớm = hủy; có rung nhẹ khi bắt đầu giữ và khi gửi xong. (Cần chủ đầu tư xác nhận — xem danh sách cuối README.)
- Địa bàn chưa có cán bộ trực / vị trí ngoài ranh giới → vô hiệu nút SOS, hiện lý do + nút gọi 112/113 nổi bật.
- Độ chính xác GPS kém (> ~100 m) → cảnh báo, vẫn cho gửi nhưng ghi rõ độ sai số.
- Sau khi gửi: màn trạng thái có “Gọi 113”; hủy chỉ khi chưa có cán bộ nhận, phải qua hộp thoại xác nhận.
- Mọi màn SOS giữ độ tương phản cao (nền trắng, nút đỏ #BA263B chữ trắng 6.1:1).

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c08-ready | Sẵn sàng | [png](png/c08-ready.png) | [png](png/wireframe/c08-ready.png) |
| c08-holding | Đang giữ | [png](png/c08-holding.png) | [png](png/wireframe/c08-holding.png) |
| c08-nogps | Chưa có GPS | [png](png/c08-nogps.png) | [png](png/wireframe/c08-nogps.png) |
| c08-noduty | Chưa có cán bộ trực | [png](png/c08-noduty.png) | [png](png/wireframe/c08-noduty.png) |
| c08-sent | Đã gửi, chờ nhận | [png](png/c08-sent.png) | [png](png/wireframe/c08-sent.png) |
| c08-ack | Cán bộ đã nhận | [png](png/c08-ack.png) | [png](png/wireframe/c08-ack.png) |
| c08-cancel | Xác nhận hủy | [png](png/c08-cancel.png) | [png](png/wireframe/c08-cancel.png) |

**Đi tiếp tới:** c03 (quay lại)

---

## C09 · Thông báo

**Mục đích.** Hộp thư cập nhật xử lý hồ sơ/SOS và cảnh báo; mở thẳng tới hồ sơ liên quan.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c09-thong-bao.html](c09-thong-bao.html)

**Thành phần**
- Tabs Tất cả/Chưa đọc
- List item + chấm chưa đọc
- Badge số ở nút chuông
- Toast thông báo mới
- Empty / Login gate

**Quy tắc hiển thị**
- Huy hiệu số nằm trong góc nút chuông, tối đa “99+”, không đè lên nhãn “Thông báo”.
- Chạm thông báo → đánh dấu đã đọc và mở đúng hồ sơ (c07).
- Thông báo đẩy trên màn khoá chỉ hiện tiêu đề + mã hồ sơ, không hiện nội dung vụ việc.
- Chưa đăng nhập: hiện màn mời đăng nhập, không báo lỗi.
- Mới tới khi đang mở app: toast 9 giây, chạm để mở.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c09-list | Có thông báo | [png](png/c09-list.png) | [png](png/wireframe/c09-list.png) |
| c09-toast | Thông báo mới (toast) | [png](png/c09-toast.png) | [png](png/wireframe/c09-toast.png) |
| c09-empty | Rỗng | [png](png/c09-empty.png) | [png](png/wireframe/c09-empty.png) |
| c09-login | Chưa đăng nhập | [png](png/c09-login.png) | [png](png/wireframe/c09-login.png) |
| c09-loading | Đang tải | [png](png/c09-loading.png) | [png](png/wireframe/c09-loading.png) |

**Đi tiếp tới:** c07 (mở hồ sơ) · c02 (đăng nhập)

---

## C10 · Tài khoản

**Mục đích.** Quản lý đăng nhập, mật khẩu, thông báo; nơi duy nhất người dân cấu hình app.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c10-tai-khoan.html](c10-tai-khoan.html)

**Thành phần**
- Thẻ người dùng
- List item + switch
- Mục xổ ra (đổi mật khẩu)
- Field/Input lỗi
- Button secondary danger-text
- Empty (khách)

**Quy tắc hiển thị**
- Khách: chỉ thấy lời mời đăng nhập; không hiện cài đặt rỗng.
- Đổi mật khẩu: cần mật khẩu hiện tại, mới ≥ 8 ký tự; thành công hiện toast “Đã đổi mật khẩu”.
- Công tắc thông báo phản ánh đúng quyền của hệ thống; nếu bị tắt trong điện thoại → hướng dẫn mở Cài đặt › Ứng dụng › Bản đồ số Cảnh sát khu vực › Thông báo.
- Đăng xuất không cần xác nhận (thao tác an toàn, đăng nhập lại được).
- Nút đăng xuất ở cuối trang, tách khỏi nhóm cài đặt.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c10-default | Đã đăng nhập | [png](png/c10-default.png) | [png](png/wireframe/c10-default.png) |
| c10-password | Đổi mật khẩu (lỗi) | [png](png/c10-password.png) | [png](png/wireframe/c10-password.png) |
| c10-guest | Khách | [png](png/c10-guest.png) | [png](png/wireframe/c10-guest.png) |

**Đi tiếp tới:** c13 (hướng dẫn) · c01 (đăng xuất)

---

## C11 · Trợ lý bản đồ (AI)

**Mục đích.** Hỏi nhanh bằng lời: ai là CSKV, trụ sở gần nhất, cảnh báo hôm nay; luôn có lối thoát sang tìm kiếm thủ công.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c11-tro-ly.html](c11-tro-ly.html)

**Thành phần**
- Bong bóng trò chuyện
- Chip câu hỏi gợi ý
- Input + micro + nút gửi
- Alert warn (lỗi AI)
- Spinner

**Quy tắc hiển thị**
- Chỉ trả lời thông tin công khai (địa bàn, danh bạ, cảnh báo); không nhận báo vụ việc — hướng tới Gửi phản ánh/SOS.
- Câu trả lời có hành động đi kèm (Gọi, Xem bản đồ).
- Lỗi/AI quá tải: nói rõ, KHÔNG đoán; gợi ý Danh bạ.
- Nút micro dùng chung cơ chế nhận dạng giọng nói với Gửi phản ánh.
- Nội dung do AI tạo có nhãn “Trợ lý tự động” và không thay thế tư vấn pháp lý.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c11-default | Mặc định | [png](png/c11-default.png) | [png](png/wireframe/c11-default.png) |
| c11-answer | Có câu trả lời | [png](png/c11-answer.png) | [png](png/wireframe/c11-answer.png) |
| c11-loading | Đang trả lời | [png](png/c11-loading.png) | [png](png/wireframe/c11-loading.png) |
| c11-error | Lỗi / bận | [png](png/c11-error.png) | [png](png/wireframe/c11-error.png) |

**Đi tiếp tới:** c03 · c04 · c06

---

## C12 · Menu Tính năng (ngăn kéo)

**Mục đích.** Lối vào đầy đủ mọi tính năng; nơi duy nhất ngoài SOS có nút gọi 113.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c12-menu-tinh-nang.html](c12-menu-tinh-nang.html)

**Thành phần**
- Drawer phải
- Scrim
- List item + mô tả
- Button danger lg (113)

**Quy tắc hiển thị**
- Mở từ nút “Tính năng”, trượt vào 180 ms; Esc/chạm nền tối để đóng, trả focus về nút mở.
- Giữ focus trong ngăn kéo khi mở (focus trap).
- Không hiện mục “Đang phát triển”; tính năng chưa có thì không liệt kê.
- Bản citizen-only không có “Đăng nhập cán bộ”.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c12-open | Đang mở | [png](png/c12-open.png) | [png](png/wireframe/c12-open.png) |

**Đi tiếp tới:** c04 · c05 · c06 · c14 · c11 · c09

---

## C13 · Hướng dẫn lần đầu

**Mục đích.** Giới thiệu 3 điểm then chốt (tìm địa bàn, SOS, phản ánh) mà không chặn thao tác.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c13-huong-dan.html](c13-huong-dan.html)

**Thành phần**
- Thanh gợi ý (card nổi)
- Vòng sáng quanh phần tử (spot)
- Button ghost/primary

**Quy tắc hiển thị**
- Không phủ tối toàn màn hình, không chặn chạm vào app (pointer-events chỉ nhận trên thanh gợi ý).
- Chỉ tự chạy lần đầu; “Bỏ qua” ghi nhớ, xem lại ở Tài khoản hoặc Menu.
- Vị trí thanh gợi ý tránh che phần tử đang nhấn mạnh.
- Tối đa 3 bước.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c13-step1 | Bước 1 | [png](png/c13-step1.png) | [png](png/wireframe/c13-step1.png) |
| c13-step2 | Bước 2 | [png](png/c13-step2.png) | [png](png/wireframe/c13-step2.png) |
| c13-step3 | Bước 3 | [png](png/c13-step3.png) | [png](png/wireframe/c13-step3.png) |

**Đi tiếp tới:** c03

---

## C14 · Đánh giá sau xử lý

**Mục đích.** Thu mức độ hài lòng sau khi hồ sơ có kết quả; một lần cho mỗi hồ sơ.

**Thiết bị:** Điện thoại (320–640 px) · **Trang:** [c14-danh-gia.html](c14-danh-gia.html)

**Thành phần**
- Thẻ hồ sơ
- Sao đánh giá (radiogroup)
- Textarea
- Button primary lg
- Alert thành công

**Quy tắc hiển thị**
- Chỉ mở cho hồ sơ ở trạng thái “Đã có kết quả”/“Đã đóng” của chính người dân.
- Sao có tên đọc “n sao”, chọn được bằng bàn phím mũi tên.
- Gửi xong không sửa được; hiển thị cảm ơn.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| c14-form | Đánh giá | [png](png/c14-form.png) | [png](png/wireframe/c14-form.png) |
| c14-done | Đã gửi | [png](png/c14-done.png) | [png](png/wireframe/c14-done.png) |
| c14-none | Không có hồ sơ | [png](png/c14-none.png) | [png](png/wireframe/c14-none.png) |

**Đi tiếp tới:** c07 · c03

---

## O01 · Đăng nhập cán bộ

**Mục đích.** Xác thực cán bộ; chặn dò mật khẩu nhưng không lộ thông tin tài khoản có tồn tại hay không.

**Thiết bị:** Máy tính (≥ 1024 px) · **Trang:** [o01-dang-nhap-can-bo.html](o01-dang-nhap-can-bo.html)

**Thành phần**
- Card
- Field/Input
- Button primary lg
- Alert lỗi

**Quy tắc hiển thị**
- Thông báo lỗi chung (“tên đăng nhập hoặc mật khẩu chưa đúng”), không nói sai ở ô nào.
- Sai 5 lần → khoá tạm 10 phút, hiển thị rõ thời gian.
- Phiên hết hạn → quay về màn này kèm thông báo “Phiên đã hết, mời đăng nhập lại”.
- Chỉ có trong bản web; bản Android người dân không chứa màn này.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| o01-default | Mặc định | [png](png/o01-default.png) | [png](png/wireframe/o01-default.png) |
| o01-error | Sai thông tin | [png](png/o01-error.png) | [png](png/wireframe/o01-error.png) |
| o01-lock | Tạm khoá | [png](png/o01-lock.png) | [png](png/wireframe/o01-lock.png) |
| o01-loading | Đang xử lý | [png](png/o01-loading.png) | [png](png/wireframe/o01-loading.png) |

**Đi tiếp tới:** o02

---

## O02 · Hàng đợi & chi tiết hồ sơ

**Mục đích.** Cán bộ trực thấy ngay việc cần làm, mở hồ sơ và xử lý bằng 1 nút “việc cần làm tiếp”.

**Thiết bị:** Máy tính (≥ 1024 px) · **Trang:** [o02-hang-doi.html](o02-hang-doi.html)

**Thành phần**
- Officer topbar + nav
- Tabs phạm vi hàng đợi
- List item + thumbnail + status
- Action card (nút chính + nút phụ)
- Timeline
- Mini map

**Quy tắc hiển thị**
- SOS luôn đứng đầu hàng đợi, nền nhấn đỏ, kèm biểu tượng còi.
- Mỗi hồ sơ chỉ có MỘT nút chính theo trạng thái; việc hiếm gặp nằm ở nút phụ.
- Nhận hồ sơ = 1 chạm (tự gộp “tiếp nhận + phân công” nhưng vẫn ghi từng bước).
- Bước cần lời nhắn bắt buộc (xong/đóng/ngoài phạm vi) hiện ô ghi kết quả; tối thiểu 20 ký tự; công tắc “Cho người dân đọc”.
- Thao tác không thể hoàn tác (đóng) bấm 2 lần: lần 1 hiện cảnh báo vàng.
- Dưới 1024px: 1 cột, thanh điều hướng thành thanh tab dưới (Hàng đợi · Bản đồ · Nghiệp vụ).
- Số trên “Hàng đợi” = hồ sơ cần chú ý; cập nhật tự động, không tải lại trang.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| o02-take | Hồ sơ mới – Nhận hồ sơ | [png](png/o02-take.png) | [png](png/wireframe/o02-take.png) |
| o02-start | Đã nhận – Bắt đầu xử lý | [png](png/o02-start.png) | [png](png/wireframe/o02-start.png) |
| o02-done-form | Ghi kết quả (ô bắt buộc) | [png](png/o02-done-form.png) | [png](png/wireframe/o02-done-form.png) |
| o02-done-err | Ghi kết quả – lỗi ngắn | [png](png/o02-done-err.png) | [png](png/wireframe/o02-done-err.png) |
| o02-close-confirm | Đóng hồ sơ – xác nhận | [png](png/o02-close-confirm.png) | [png](png/wireframe/o02-close-confirm.png) |
| o02-saving | Đang lưu | [png](png/o02-saving.png) | [png](png/wireframe/o02-saving.png) |
| o02-empty | Hàng đợi trống | [png](png/o02-empty.png) | [png](png/wireframe/o02-empty.png) |
| o02-loading | Đang tải | [png](png/o02-loading.png) | [png](png/wireframe/o02-loading.png) |
| o02-error | Lỗi tải | [png](png/o02-error.png) | [png](png/wireframe/o02-error.png) |
| o02-mobile | Điện thoại (<1024px) | [png](png/o02-mobile.png) | [png](png/wireframe/o02-mobile.png) |

**Đi tiếp tới:** o03 (SOS tới) · o04 · o06

---

## O03 · Báo động SOS toàn màn hình

**Mục đích.** Không thể bỏ lỡ: SOS mới phủ toàn màn hình, có còi, đến khi có người nhận.

**Thiết bị:** Máy tính (≥ 1024 px) · **Trang:** [o03-bao-dong-sos.html](o03-bao-dong-sos.html)

**Thành phần**
- Alarm overlay (z=100)
- Nút “Nhận SOS ngay”
- Nút tắt còi tạm
- Còi âm thanh

**Quy tắc hiển thị**
- Phủ trên mọi thứ (z-alarm 100), nền đỏ sẫm #8E1C2E, chữ trắng (≥ 7:1).
- Còi lặp đến khi có người “Nhận”; “Tắt còi 30 giây” chỉ tắt tiếng, KHÔNG đóng báo động.
- Quá 2 phút chưa ai nhận → đổi tiêu đề “CHƯA CÓ NGƯỜI NHẬN” và gửi báo cho cán bộ dự phòng.
- Trình duyệt cần người dùng bật còi 1 lần (chính sách tự phát âm thanh) — nút “Còi bật/Còi tắt” trên thanh trên cùng.
- Nhận SOS → ghi 2 bước (đã phát → đã nhận) và gửi thông báo cho người dân.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| o03-new | SOS mới | [png](png/o03-new.png) | [png](png/wireframe/o03-new.png) |
| o03-late | Quá 2 phút | [png](png/o03-late.png) | [png](png/wireframe/o03-late.png) |

**Đi tiếp tới:** o02

---

## O04 · Bản đồ trực ban

**Mục đích.** Nhìn tổng thể hồ sơ/SOS/cảnh báo trên địa bàn phụ trách.

**Thiết bị:** Máy tính (≥ 1024 px) · **Trang:** [o04-ban-do-truc-ban.html](o04-ban-do-truc-ban.html)

**Thành phần**
- Bản đồ + ghim theo loại
- Bộ lọc lớp (chip)
- Thẻ chi tiết nhanh

**Quy tắc hiển thị**
- Ghim SOS đỏ + nhấp nháy; phản ánh xanh biển; cảnh báo vàng.
- Chạm ghim → thẻ tóm tắt + nút “Mở hồ sơ”.
- Chỉ hiện địa bàn của cán bộ (trừ quản trị).

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| o04-default | Mặc định | [png](png/o04-default.png) | [png](png/wireframe/o04-default.png) |

**Đi tiếp tới:** o02

---

## O05 · Nghiệp vụ – Phát cảnh báo

**Mục đích.** Cán bộ phát cảnh báo công khai theo loại và vị trí trên bản đồ, người dân toàn tỉnh thấy ngay.

**Thiết bị:** Máy tính (≥ 1024 px) · **Trang:** [o05-phat-canh-bao.html](o05-phat-canh-bao.html)

**Thành phần**
- Form (chip, input, textarea, select)
- Bản đồ chọn vị trí
- Alert thành công
- Button primary lg

**Quy tắc hiển thị**
- Bắt buộc: loại, tiêu đề, nội dung; phạm vi mặc định toàn tỉnh.
- Chọn vị trí trên bản đồ → ghim vàng, kèm bán kính (nếu có).
- Trước khi phát nhắc “Cảnh báo sẽ hiện công khai” (khuyến nghị thêm bước xác nhận cho loại An ninh).
- Không đưa thông tin cá nhân người dân vào nội dung.

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| o05-default | Mặc định | [png](png/o05-default.png) | [png](png/wireframe/o05-default.png) |
| o05-error | Thiếu tiêu đề | [png](png/o05-error.png) | [png](png/wireframe/o05-error.png) |
| o05-sending | Đang phát | [png](png/o05-sending.png) | [png](png/wireframe/o05-sending.png) |
| o05-ok | Đã phát | [png](png/o05-ok.png) | [png](png/wireframe/o05-ok.png) |

**Đi tiếp tới:** c05 (người dân thấy) · o06 (tab Lưu trữ & báo cáo)

---

## O06 · Lưu trữ & báo cáo

**Mục đích.** Xem lại hồ sơ đã đóng và xuất báo cáo CSV/PDF cho lãnh đạo.

**Thiết bị:** Máy tính (≥ 1024 px) · **Trang:** [o06-luu-tru-bao-cao.html](o06-luu-tru-bao-cao.html)

**Thành phần**
- Bộ lọc ngày/loại
- Thẻ KPI
- Table
- Button xuất CSV/PDF
- Empty/Skeleton

**Quy tắc hiển thị**
- Mặc định 30 ngày gần nhất, theo địa bàn của cán bộ.
- Xuất CSV: mở được bằng Excel (UTF-8 có BOM). Xuất PDF: bố cục in A4 dọc, có đầu trang đơn vị và khoảng ngày.
- Đang tạo báo cáo: vô hiệu cả 2 nút xuất, hiển thị spinner.
- Số liệu căn phải, dùng chữ số cùng độ rộng (tabular-nums).

**Trạng thái**

| Mã | Trạng thái | UI | Wireframe |
|---|---|---|---|
| o06-default | Mặc định | [png](png/o06-default.png) | [png](png/wireframe/o06-default.png) |
| o06-empty | Không có kết quả | [png](png/o06-empty.png) | [png](png/wireframe/o06-empty.png) |
| o06-loading | Đang tải | [png](png/o06-loading.png) | [png](png/wireframe/o06-loading.png) |
| o06-exporting | Đang xuất PDF | [png](png/o06-exporting.png) | [png](png/wireframe/o06-exporting.png) |

**Đi tiếp tới:** o02

---

