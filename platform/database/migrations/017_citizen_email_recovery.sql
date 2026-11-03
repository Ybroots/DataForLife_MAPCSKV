-- Email khôi phục mật khẩu của tài khoản người dân: thêm email, mã xác minh/đặt lại (chỉ lưu bản băm) và mở rộng nhật ký.
-- Cần migration 016 (bảng citizen_account_events). An toàn khi chạy lại.
BEGIN;

ALTER TABLE citizen_accounts
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS email_normalized text,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS citizen_email_codes (
  citizen_id text NOT NULL REFERENCES citizen_accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (citizen_id, purpose)
);

DO $$
BEGIN
  IF to_regclass('public.citizen_account_events') IS NOT NULL THEN
    ALTER TABLE citizen_account_events DROP CONSTRAINT IF EXISTS citizen_account_events_event_type_check;
    ALTER TABLE citizen_account_events ADD CONSTRAINT citizen_account_events_event_type_check CHECK (event_type IN (
      'recovery_code_created', 'password_reset_recovery', 'assisted_reset_issued', 'password_reset_assisted',
      'email_verified', 'password_reset_email'
    ));
  END IF;
END $$;

COMMIT;
