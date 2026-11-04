-- Trang Thống kê công khai: bảng ý kiến đã được duyệt để hiển thị (ý kiến của người dân hoặc cán bộ).
-- Chỉ ý kiến có approved = true mới hiện ra. Ý kiến thật phải được người nói đồng ý trước khi duyệt.
-- is_demo = true là ý kiến mẫu dùng khi trình diễn (xóa bằng database/seed/demo-mock-data-remove.sql).
-- An toàn khi chạy lại.

BEGIN;

CREATE TABLE IF NOT EXISTS public_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_role text NOT NULL CHECK (author_role IN ('citizen', 'officer')),
  author_label text NOT NULL CHECK (char_length(author_label) BETWEEN 2 AND 120),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 10 AND 400),
  score smallint CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  area_code text,
  approved boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_testimonials_approved_idx ON public_testimonials (approved, sort_order, created_at DESC);

COMMIT;
