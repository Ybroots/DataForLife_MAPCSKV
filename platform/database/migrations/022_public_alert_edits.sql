-- Ghi lại ai sửa hoặc gỡ cảnh báo công khai và khi nào.
BEGIN;

ALTER TABLE public_alerts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by text REFERENCES workflow_actors(id);

COMMIT;
