-- Cán bộ CSKV gắn với một khu vực, và vai trò chỉ huy (supervisor) xem toàn phường.
--
-- workflow_actors.service_area_id: khu vực mà cán bộ phụ trách. Cán bộ có khu vực chỉ thấy và xử lý hồ sơ phản ánh,
--   SOS thuộc khu vực đó. Cán bộ chưa gắn khu vực (NULL) vẫn thấy toàn địa bàn như trước.
-- workflow_actors.phone, beat_note: số điện thoại công khai và địa bàn phụ trách theo quyết định phân công
--   (tổ dân phố), hiển thị ở trang cảnh sát khu vực.
-- Chỉ huy là actor_type = 'supervisor' (đã có trong ràng buộc từ migration 005), không gắn khu vực, chỉ xem.
--
-- DỮ LIỆU MINH HỌA: 5 cán bộ lấy mẫu từ "Danh sách CSKV mới 01.07.2026" được ghép vào 5 khu vực (5 phường cũ) của
-- Xuân Hương để trình diễn. Danh sách phân công chia theo tổ dân phố, chưa có bảng đối chiếu tổ dân phố với khu vực;
-- khi có phân chia chính thức, sửa lại các dòng dưới đây (hoặc cập nhật service_area_id) mà không phải đổi mã.
--
-- Chạy lại được nhiều lần.

BEGIN;

ALTER TABLE workflow_actors
  ADD COLUMN IF NOT EXISTS service_area_id uuid REFERENCES service_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS beat_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_actors_area_only_officer') THEN
    ALTER TABLE workflow_actors ADD CONSTRAINT workflow_actors_area_only_officer
      CHECK (service_area_id IS NULL OR actor_type = 'officer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_actors_phone_format') THEN
    ALTER TABLE workflow_actors ADD CONSTRAINT workflow_actors_phone_format
      CHECK (phone IS NULL OR phone ~ '^0[0-9]{9,10}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS workflow_actors_service_area_idx
  ON workflow_actors (service_area_id) WHERE service_area_id IS NOT NULL;

UPDATE workflow_actors a
SET display_name = v.display_name,
    service_area_id = sa.id,
    phone = v.phone,
    beat_note = v.beat_note,
    updated_at = now()
FROM (VALUES
  ('officer-cskv-01', 'Vũ Tuấn Huy',          '0982255229', 'XH-P1',  'Tổ DP Hoà Bình (Đoàn Kết + Hoà Bình)'),
  ('officer-cskv-02', 'Trịnh Hồ Quang Trung', '0388404875', 'XH-P2',  'Tổ DP Đa Hoà (Đa Hoà + Mimosa + Hàm Nghi)'),
  ('officer-cskv-03', 'Huỳnh Quốc Nam',       '0918080597', 'XH-P3',  'Tổ DP Lý Tự Trọng (Bùi Thị Xuân 1 + Võ Thị Sáu + Lý Tự Trọng) và Tổ DP Bùi Thị Xuân'),
  ('officer-cskv-04', 'Cao Đức Thanh',        '0397202204', 'XH-P4',  'Tổ DP Tân Lạc (Tô Hiến Thành + Tân Lạc) và Tổ DP An Bình'),
  ('officer-cskv-05', 'Nguyễn Văn Tùng',      '0972345246', 'XH-P10', 'Tổ DP Lê Hồng Phong và Tổ DP Huỳnh Thúc Kháng')
) AS v(actor_id, display_name, phone, area_code, beat_note)
JOIN service_areas sa ON sa.code = v.area_code
WHERE a.id = v.actor_id AND a.actor_type = 'officer';

-- Danh bạ công khai: gắn 5 cán bộ mẫu vào khu vực để trang cảnh sát khu vực hiển thị "ai phụ trách khu vực nào".
UPDATE directory_entries d
SET service_area_id = sa.id,
    role_title = 'Cảnh sát khu vực · ' || v.beat_note,
    updated_at = now()
FROM (VALUES
  ('xuan-huong-03', 'XH-P1',  'Tổ DP Hoà Bình'),
  ('xuan-huong-11', 'XH-P2',  'Tổ DP Đa Hoà'),
  ('xuan-huong-16', 'XH-P3',  'Tổ DP Lý Tự Trọng, Bùi Thị Xuân'),
  ('xuan-huong-07', 'XH-P4',  'Tổ DP Tân Lạc, An Bình'),
  ('xuan-huong-01', 'XH-P10', 'Tổ DP Lê Hồng Phong, Huỳnh Thúc Kháng')
) AS v(source_id, area_code, beat_note)
JOIN service_areas sa ON sa.code = v.area_code
WHERE d.source_system = 'cskv_roster' AND d.source_id = v.source_id;

COMMIT;
