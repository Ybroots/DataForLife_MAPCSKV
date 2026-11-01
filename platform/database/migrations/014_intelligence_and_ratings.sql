-- Nhóm phản ánh trùng, gợi ý AI cho cán bộ, đánh giá sau SOS và đánh giá ứng dụng.
--
-- incident_reports.duplicate_of_id: cán bộ đã xác nhận phản ánh này trùng với hồ sơ chính.
-- incident_reports.suggested_duplicate_of_id: hệ thống tự gợi ý khi tiếp nhận (quy tắc vị trí, thời gian,
--   lĩnh vực và nội dung), chờ cán bộ xác nhận hoặc bỏ qua.
-- incident_ai_reviews: mỗi lần cán bộ nhờ AI gợi ý lĩnh vực và nhận biết ảnh, kèm quyết định cuối của cán bộ
--   (để đo tỷ lệ gợi ý đúng). Không lưu ảnh hay nội dung gửi cho AI.
-- sos_ratings, app_ratings: điểm hài lòng 1–5 sau SOS và cho ứng dụng.
--
-- Migration an toàn khi chạy lại.

BEGIN;

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS duplicate_of_id uuid REFERENCES incident_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_duplicate_of_id uuid REFERENCES incident_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_duplicate_score numeric(4, 2),
  ADD COLUMN IF NOT EXISTS duplicate_linked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_reports_duplicate_not_self') THEN
    ALTER TABLE incident_reports ADD CONSTRAINT incident_reports_duplicate_not_self
      CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS incident_reports_duplicate_of_idx ON incident_reports (duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS incident_reports_locality_created_idx ON incident_reports (locality_id, created_at);

CREATE TABLE IF NOT EXISTS incident_ai_reviews (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  original_category text NOT NULL,
  suggested_category text NOT NULL
    CHECK (suggested_category IN ('security', 'traffic', 'public_order', 'administrative', 'environment', 'other')),
  confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  image_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision text CHECK (decision IS NULL OR decision IN ('accepted', 'changed', 'kept')),
  decided_category text
    CHECK (decided_category IS NULL OR decided_category IN ('security', 'traffic', 'public_order', 'administrative', 'environment', 'other')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incident_ai_reviews_incident_idx ON incident_ai_reviews (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sos_ratings (
  id uuid PRIMARY KEY,
  sos_event_id uuid NOT NULL UNIQUE REFERENCES sos_events(id) ON DELETE CASCADE,
  citizen_external_id text NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_ratings (
  citizen_external_id text PRIMARY KEY,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
