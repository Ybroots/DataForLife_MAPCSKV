-- Nhật ký khi chỉ huy đổi tên đăng nhập, đặt mật khẩu hoặc đổi khu vực của cán bộ.
-- Bảng workflow_audit_events chỉ dành cho hồ sơ/SOS (aggregate_id kiểu uuid), nên dùng bảng riêng.
-- Không lưu mật khẩu hay bản băm: chỉ ghi ai đổi, đổi gì, lúc nào. Chạy lại được nhiều lần.
BEGIN;

CREATE TABLE IF NOT EXISTS officer_account_audit_events (
  id bigserial PRIMARY KEY,
  target_actor_id text NOT NULL REFERENCES workflow_actors(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('username_changed', 'password_set', 'service_area_changed')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS officer_account_audit_target_idx
  ON officer_account_audit_events (target_actor_id, created_at DESC);

COMMIT;
