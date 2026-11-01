-- Thông báo đẩy cho ứng dụng người dân (FCM).
--
-- push_devices: mỗi dòng là một thiết bị đã bật thông báo. Chỉ lưu mã thiết bị FCM, mã tài khoản người dân
-- (khi thiết bị đang đăng nhập, dùng để gửi cập nhật hồ sơ) và các mã địa bàn người dùng chọn theo dõi
-- (dùng để gửi cảnh báo khu vực). Không lưu vị trí GPS.
-- push_deliveries: nhật ký gửi để mỗi thông báo chỉ tới một thiết bị đúng một lần, kể cả khi API chạy lại.
--
-- Migration an toàn khi chạy lại.

BEGIN;

CREATE TABLE IF NOT EXISTS push_devices (
  id bigserial PRIMARY KEY,
  token text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 20 AND 4096),
  citizen_id text,
  area_codes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(area_codes) <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_devices_area_codes_gin ON push_devices USING gin (area_codes);
CREATE INDEX IF NOT EXISTS push_devices_citizen_idx ON push_devices (citizen_id) WHERE citizen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_devices_updated_idx ON push_devices (updated_at);

CREATE TABLE IF NOT EXISTS push_deliveries (
  kind text NOT NULL CHECK (kind IN ('alert', 'citizen')),
  ref_id text NOT NULL,
  device_id bigint NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref_id, device_id)
);

CREATE INDEX IF NOT EXISTS push_deliveries_created_idx ON push_deliveries (created_at);

COMMIT;
