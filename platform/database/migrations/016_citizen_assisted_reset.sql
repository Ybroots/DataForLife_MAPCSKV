-- Cán bộ cấp mã đặt lại mật khẩu cho người dân (đã xác minh danh tính trực tiếp hoặc qua điện thoại), kèm nhật ký.
-- Cần migration 015 (cột recovery_code_hash). Chỉ lưu bản băm của mã; mã dùng một lần và hết hạn.
-- An toàn khi chạy lại.
BEGIN;

ALTER TABLE citizen_accounts
  ADD COLUMN IF NOT EXISTS assisted_reset_hash text,
  ADD COLUMN IF NOT EXISTS assisted_reset_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS assisted_reset_issued_by text;

CREATE TABLE IF NOT EXISTS citizen_account_events (
  id bigserial PRIMARY KEY,
  citizen_id text NOT NULL REFERENCES citizen_accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'recovery_code_created', 'password_reset_recovery', 'assisted_reset_issued', 'password_reset_assisted'
  )),
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS citizen_account_events_citizen_idx
  ON citizen_account_events (citizen_id, created_at DESC);

COMMIT;
