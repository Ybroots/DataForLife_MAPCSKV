/**
 * Lấy lại mật khẩu (email, mã khôi phục, cán bộ cấp mã). Bật mặc định.
 * Cần máy chủ đã chạy migration 015-017 (email cần thêm cấu hình SMTP; chưa có thì giao diện ghi rõ "chưa kết nối" và vẫn dùng được mã khôi phục).
 * Tắt tạm bằng cách build với VITE_PASSWORD_RECOVERY=false: khi đó giao diện chỉ hiện thông báo "đang phát triển".
 */
export const PASSWORD_RECOVERY_ENABLED = import.meta.env.VITE_PASSWORD_RECOVERY !== 'false';
