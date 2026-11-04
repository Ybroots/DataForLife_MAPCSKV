-- Hồ sơ phản ánh và SOS đã gửi trước đây chưa có khu vực (service_area_id rỗng) vì ranh giới khu vực còn là dữ liệu
-- trình diễn nên chưa được định tuyến. Từ nay hệ thống giao hồ sơ vào khu vực đã có cán bộ phụ trách; migration này gán
-- khu vực cho các hồ sơ cũ theo vị trí để đúng cán bộ khu vực nhìn thấy và xử lý chúng.
--
-- Chỉ cập nhật hồ sơ chưa có khu vực và có đúng một khu vực (có cán bộ phụ trách hoặc đã xác minh) chứa điểm gửi;
-- điểm nằm đúng trên ranh giới giữa hai khu vực được giữ nguyên. Chạy lại được nhiều lần.

BEGIN;

UPDATE incident_reports i
SET service_area_id = (
  SELECT x.id
  FROM service_areas x
  WHERE x.locality_id = i.locality_id
    AND ((x.is_demo = false AND x.provenance_status IN ('manually_verified', 'official'))
         OR EXISTS (SELECT 1 FROM workflow_actors a WHERE a.service_area_id = x.id AND a.actor_type = 'officer' AND a.active = true))
    AND ST_Covers(x.geom, i.geom)
)
WHERE i.service_area_id IS NULL
  AND (
    SELECT count(*)
    FROM service_areas x
    WHERE x.locality_id = i.locality_id
      AND ((x.is_demo = false AND x.provenance_status IN ('manually_verified', 'official'))
           OR EXISTS (SELECT 1 FROM workflow_actors a WHERE a.service_area_id = x.id AND a.actor_type = 'officer' AND a.active = true))
      AND ST_Covers(x.geom, i.geom)
  ) = 1;

UPDATE sos_events s
SET service_area_id = (
  SELECT x.id
  FROM service_areas x
  WHERE x.locality_id = s.locality_id
    AND ((x.is_demo = false AND x.provenance_status IN ('manually_verified', 'official'))
         OR EXISTS (SELECT 1 FROM workflow_actors a WHERE a.service_area_id = x.id AND a.actor_type = 'officer' AND a.active = true))
    AND ST_Covers(x.geom, s.geom)
)
WHERE s.service_area_id IS NULL
  AND (
    SELECT count(*)
    FROM service_areas x
    WHERE x.locality_id = s.locality_id
      AND ((x.is_demo = false AND x.provenance_status IN ('manually_verified', 'official'))
           OR EXISTS (SELECT 1 FROM workflow_actors a WHERE a.service_area_id = x.id AND a.actor_type = 'officer' AND a.active = true))
      AND ST_Covers(x.geom, s.geom)
  ) = 1;

COMMIT;
