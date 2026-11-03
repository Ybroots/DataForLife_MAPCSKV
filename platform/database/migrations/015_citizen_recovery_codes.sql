-- Mã khôi phục mật khẩu của tài khoản người dân.
-- Chỉ lưu bản băm (scrypt) của mã; mã gốc hiện đúng một lần cho người dân và không thể xem lại.
-- An toàn khi chạy lại: chỉ thêm cột nếu chưa có, không đụng dữ liệu hiện có.
BEGIN;

ALTER TABLE citizen_accounts
  ADD COLUMN IF NOT EXISTS recovery_code_hash text,
  ADD COLUMN IF NOT EXISTS recovery_code_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

COMMIT;
