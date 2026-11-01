-- Khu vực trình diễn cho hai địa bàn thí điểm thứ hai và thứ ba: Xuân Trường (24805) và Lâm Viên (24778) - Đà Lạt.
--
-- Đây là DỮ LIỆU MINH HỌA. Mỗi địa bàn được chia bằng sơ đồ Voronoi quanh các điểm hạt giống cố định
-- (tâm cụm k-means của các điểm mẫu trong ranh địa bàn), rồi cắt theo đúng polygon cha. Vì vậy:
--   * các khu vực phủ kín ranh địa bàn, không chồng lấn;
--   * chúng KHÔNG phải ranh xã/phường cũ và KHÔNG phải ranh phân công CSKV đã được phê duyệt.
-- Khi có ranh được duyệt, thay thế các dòng này (source_system = 'pilot-demo-voronoi') bằng ranh chính thức.
--
-- Migration an toàn khi chạy lại và bỏ qua địa bàn chưa được nạp vào bảng localities/boundaries.

BEGIN;

WITH seeds(locality_code, display_order, code, name, seed_lng, seed_lat, display_color) AS (
  VALUES
    ('24805', 1, 'XT-K1', 'Khu vực 1 · Bắc',       108.535953, 11.954075, '#1D6F8A'),
    ('24805', 2, 'XT-K2', 'Khu vực 2 · Tây Bắc',   108.503239, 11.920182, '#3A7D44'),
    ('24805', 3, 'XT-K3', 'Khu vực 3 · Đông Nam',  108.560356, 11.884081, '#7A5AA6'),
    ('24805', 4, 'XT-K4', 'Khu vực 4 · Nam',       108.521306, 11.845448, '#B36A2E'),
    ('24778', 1, 'LV-K1', 'Khu vực 1 · Tây Bắc',   108.454750, 11.988887, '#1D6F8A'),
    ('24778', 2, 'LV-K2', 'Khu vực 2 · Đông',      108.486830, 11.975050, '#3A7D44'),
    ('24778', 3, 'LV-K3', 'Khu vực 3 · Tây Nam',   108.455865, 11.961247, '#7A5AA6')
), seed_points AS (
  SELECT s.*, ST_SetSRID(ST_MakePoint(s.seed_lng, s.seed_lat), 4326) AS seed_geom
  FROM seeds s
), parent AS (
  SELECT l.id AS locality_id, l.code AS locality_code, b.geom
  FROM localities l
  JOIN boundaries b ON b.locality_id = l.id
  WHERE l.code IN ('24805', '24778')
), voronoi AS (
  SELECT
    p.locality_id,
    p.locality_code,
    p.geom AS parent_geom,
    ST_VoronoiPolygons(ST_Collect(sp.seed_geom), 0, ST_Expand(p.geom, 0.05)) AS cells
  FROM parent p
  JOIN seed_points sp ON sp.locality_code = p.locality_code
  GROUP BY p.locality_id, p.locality_code, p.geom
), cell_dump AS (
  SELECT locality_id, locality_code, parent_geom, (ST_Dump(cells)).geom AS cell
  FROM voronoi
), zones AS (
  SELECT
    c.locality_id,
    sp.*,
    ST_Multi(
      ST_CollectionExtract(ST_MakeValid(ST_Intersection(c.cell, c.parent_geom)), 3)
    )::geometry(MultiPolygon, 4326) AS geom
  FROM cell_dump c
  JOIN seed_points sp
    ON sp.locality_code = c.locality_code
   AND ST_Contains(c.cell, sp.seed_geom)
)
INSERT INTO service_areas (
  locality_id, code, name, legacy_ward_code, group_name, description, display_color, display_order,
  area_km2, geom, label_geom, is_demo, visibility, provenance_status,
  source_system, source_id, source_url, source_version, raw_source
)
SELECT
  z.locality_id,
  z.code,
  z.name,
  NULL,
  'Chia minh họa theo hình học',
  'Khu vực chia minh họa theo hình học trong địa bàn; chưa phải ranh đơn vị cũ hay ranh phân công CSKV.',
  z.display_color,
  z.display_order,
  round((ST_Area(z.geom::geography) / 1000000)::numeric, 4),
  z.geom,
  ST_PointOnSurface(z.geom),
  true,
  'public',
  'reference_reconstructed',
  'pilot-demo-voronoi',
  lower(z.code),
  NULL,
  'Voronoi quanh điểm hạt giống cố định; cắt theo ranh địa bàn ' || z.locality_code,
  jsonb_build_object(
    'seed_longitude', z.seed_lng,
    'seed_latitude', z.seed_lat,
    'method', 'voronoi cells around fixed k-means seeds, clipped to the locality boundary',
    'is_approved_cskv_boundary', false
  )
FROM zones z
WHERE NOT ST_IsEmpty(z.geom)
ON CONFLICT (code) DO UPDATE SET
  locality_id = EXCLUDED.locality_id,
  name = EXCLUDED.name,
  legacy_ward_code = EXCLUDED.legacy_ward_code,
  group_name = EXCLUDED.group_name,
  description = EXCLUDED.description,
  display_color = EXCLUDED.display_color,
  display_order = EXCLUDED.display_order,
  area_km2 = EXCLUDED.area_km2,
  geom = EXCLUDED.geom,
  label_geom = EXCLUDED.label_geom,
  is_demo = EXCLUDED.is_demo,
  visibility = EXCLUDED.visibility,
  provenance_status = EXCLUDED.provenance_status,
  source_system = EXCLUDED.source_system,
  source_id = EXCLUDED.source_id,
  source_url = EXCLUDED.source_url,
  source_version = EXCLUDED.source_version,
  raw_source = EXCLUDED.raw_source,
  updated_at = now();

DO $validation$
DECLARE
  target record;
  parent_geom geometry(MultiPolygon, 4326);
  union_geom geometry;
  sum_area double precision;
  symmetric_difference_m2 double precision;
  overlap_m2 double precision;
  zone_count integer;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES ('24805', 'XT-K%', 4), ('24778', 'LV-K%', 3)) AS t(locality_code, code_pattern, expected_zones)
  LOOP
    SELECT b.geom INTO parent_geom
    FROM boundaries b
    JOIN localities l ON l.id = b.locality_id
    WHERE l.code = target.locality_code;

    IF parent_geom IS NULL THEN
      RAISE NOTICE 'Bỏ qua kiểm tra khu vực minh họa: chưa có địa bàn %', target.locality_code;
      CONTINUE;
    END IF;

    SELECT count(*), ST_UnaryUnion(ST_Collect(sa.geom)), sum(ST_Area(sa.geom::geography))
    INTO zone_count, union_geom, sum_area
    FROM service_areas sa
    JOIN localities l ON l.id = sa.locality_id
    WHERE l.code = target.locality_code AND sa.code LIKE target.code_pattern;

    IF zone_count <> target.expected_zones THEN
      RAISE EXCEPTION 'Địa bàn %: cần % khu vực minh họa, hiện có %', target.locality_code, target.expected_zones, zone_count;
    END IF;
    IF EXISTS (
      SELECT 1 FROM service_areas sa
      JOIN localities l ON l.id = sa.locality_id
      WHERE l.code = target.locality_code AND sa.code LIKE target.code_pattern AND NOT ST_IsValid(sa.geom)
    ) THEN
      RAISE EXCEPTION 'Địa bàn %: có khu vực minh họa với hình học không hợp lệ', target.locality_code;
    END IF;

    symmetric_difference_m2 := ST_Area(ST_SymDifference(parent_geom, union_geom)::geography);
    overlap_m2 := sum_area - ST_Area(union_geom::geography);
    IF symmetric_difference_m2 > 1 OR abs(overlap_m2) > 1 THEN
      RAISE EXCEPTION 'Địa bàn %: topology khu vực minh họa sai (lệch % m2, chồng lấn % m2)',
        target.locality_code, symmetric_difference_m2, overlap_m2;
    END IF;
  END LOOP;
END
$validation$;

COMMIT;
