# Hành trình người dùng (User journey)

Thang cảm xúc: 😟 lo · 😐 trung tính · 🙂 yên tâm. “Điểm đau” = chỗ dễ bỏ cuộc; “Cơ hội” = cách thiết kế giải quyết (kèm mã màn hình).

## J1 · Bà Lan tra cứu công an khu vực rồi gọi (P1)
| Giai đoạn | Việc làm | Cảm xúc | Điểm đau | Cơ hội thiết kế |
|---|---|---|---|---|
| Biết app | Được con cháu/loa phường giới thiệu, cài từ CH Play | 😐 | Ngại cài app lạ | Tên app dễ nhớ, huy hiệu Công an quen thuộc (C01) |
| Mở lần đầu | Thấy màn chào, chọn “Người dân” | 😟→🙂 | Sợ phải đăng ký | Vào 1 chạm, không đăng nhập (C01) |
| Tìm địa bàn | Gõ “Lâm Viên” hoặc chạm bản đồ | 😐 | Gõ dấu tiếng Việt khó | Gợi ý khi gõ ≥ 2 ký tự, tìm không dấu, bấm tên trên bản đồ (C03, C04) |
| Gọi | Xem tên CSKV, bấm **Gọi** | 🙂 | Số nhỏ, bấm nhầm | Nút Gọi 44 px có chữ + biểu tượng, số hiện kèm tên (C04) |
| Kết thúc | Lưu lại để lần sau gọi nhanh | 🙂 | Quên | Danh sách “xem gần đây” (C04) |

## J2 · Chị Hà phản ánh và theo dõi đến khi có kết quả (P2)
| Giai đoạn | Việc làm | Cảm xúc | Điểm đau | Cơ hội |
|---|---|---|---|---|
| Phát hiện | Thấy đèn đường hỏng, mở app | 😐 | Không biết phản ánh ở đâu | Tab “Phản ánh” cố định dưới đáy (C03) |
| Đăng nhập | Bị yêu cầu đăng nhập | 😟 | Mất thời gian, sợ mất nội dung | Tờ trượt, quay lại đúng chỗ, giữ nội dung đã gõ (C02) |
| Điền | Chọn loại, nói/gõ mô tả, chụp ảnh, vị trí tự lấy | 😐→🙂 | Ảnh nặng; mạng yếu | Tự nén ảnh, lưu nháp, mic nhập giọng nói (C06) |
| Gửi | Bấm Gửi, nhận mã **PA-…** | 🙂 | “Gửi đi đâu rồi?” | Màn thành công có mã + địa bàn phụ trách + “Theo dõi hồ sơ” (C06→C07) |
| Chờ | Nhận thông báo đẩy khi cán bộ tiếp nhận / xử lý | 🙂 | Thông báo lộ nội dung | Chỉ hiện “Có cập nhật hồ sơ PA-…” trên màn khoá (C09) |
| Kết quả | Đọc kết quả, đánh giá | 🙂 | Quên đánh giá | Gợi ý đánh giá 1 lần, bỏ qua được (C14) |

## J3 · Người dân gặp nguy hiểm — SOS (P1/P2)
| Giai đoạn | Việc làm | Cảm xúc | Điểm đau | Cơ hội |
|---|---|---|---|---|
| Hoảng | Mở app, thấy nút **SOS** đỏ trên bản đồ | 😟 | Run tay, không tìm kiếm nổi | SOS luôn nổi, không bị che (C03) |
| Kích hoạt | Giữ nút 3 giây | 😟 | Sợ bấm nhầm / sợ không gửi được | Vòng tiến độ + rung nhẹ; thả sớm = huỷ (C08) |
| Chờ | “Đã gửi — đang chờ cán bộ nhận” | 😟→🙂 | Không biết ai nhận | Trạng thái bằng lời, nút **Gọi 113** luôn có (C08) |
| Có người nhận | Thông báo “Cán bộ đã nhận”, tên + số điện thoại | 🙂 | — | Hiện nút gọi cán bộ ngay (C08 ack) |

## J4 · Thiếu tá B xử lý hồ sơ trong ca trực (P3)
| Giai đoạn | Việc làm | Cảm xúc | Điểm đau | Cơ hội |
|---|---|---|---|---|
| Vào ca | Đăng nhập cổng cán bộ | 😐 | Quên mật khẩu, khoá tài khoản | Lỗi chung rõ ràng, nêu thời gian mở khoá (O01) |
| Nhìn việc | Mở hàng đợi, SOS đứng đầu | 😐 | Nhiều hồ sơ lẫn lộn | Tab “Cần xử lý / Của tôi / Đã đóng”, số chú ý (O02) |
| Nhận việc | Bấm **Nhận hồ sơ** | 🙂 | Phải nhớ quy trình | Một nút “việc cần làm tiếp” theo từng trạng thái (O02) |
| Xử lý | Gọi người dân, ghi kết quả (≥ 20 ký tự), bật “cho dân đọc” | 😐 | Bỏ sót ghi chép | Ô ghi chú bắt buộc ở bước cần, báo lỗi ngay (O02) |
| Đóng | Đóng hồ sơ — xác nhận 2 lần | 😐→🙂 | Đóng nhầm | Cảnh báo vàng lần 1 vì không hoàn tác (O02) |
| Báo cáo | Lọc 30 ngày, xuất CSV/PDF cho lãnh đạo | 🙂 | Excel lỗi font | CSV UTF-8 có BOM, PDF A4 có đầu trang đơn vị (O06) |

## J5 · Thiếu tá B nhận báo động SOS (P3)
| Giai đoạn | Việc làm | Cảm xúc | Điểm đau | Cơ hội |
|---|---|---|---|---|
| Báo động | Màn hình đỏ sẫm toàn màn + còi | 😟 | Đang làm việc khác, không để ý | Phủ trên mọi thứ, còi lặp đến khi có người nhận (O03) |
| Nhận | Bấm **Nhận SOS ngay** | 😟→🙂 | Phải tìm vị trí | Hiện địa chỉ, GPS, số điện thoại ngay trên báo động (O03→O02) |
| Phối hợp | Gọi nạn nhân, chỉ đường, báo đồng đội | 😐 | Quên cập nhật | Dòng thời gian tự ghi “đã nhận”, người dân nhận thông báo (O02) |
| Quá 2 phút | Chưa ai nhận | 😟 | Bỏ lỡ | Đổi tiêu đề “CHƯA CÓ NGƯỜI NHẬN” + báo cán bộ dự phòng (O03 late) |
