-- Thông báo đẩy cho cán bộ: thiết bị của cán bộ nhận SOS và phản ánh mới tại địa bàn mình phụ trách.
-- Dùng chung bảng push_devices (thêm officer_id) và push_deliveries (thêm hai loại tin). Chạy lại an toàn.

BEGIN;

ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS officer_id text REFERENCES workflow_actors(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS push_devices_officer_idx ON push_devices (officer_id) WHERE officer_id IS NOT NULL;

ALTER TABLE push_deliveries DROP CONSTRAINT IF EXISTS push_deliveries_kind_check;
ALTER TABLE push_deliveries ADD CONSTRAINT push_deliveries_kind_check
  CHECK (kind IN ('alert', 'citizen', 'officer_sos', 'officer_incident'));

COMMIT;
