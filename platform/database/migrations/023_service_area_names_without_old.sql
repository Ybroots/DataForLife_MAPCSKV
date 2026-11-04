-- Bỏ chữ "cũ" khỏi tên và mô tả các khu vực phụ trách của phường Xuân Hương ("Khu vực Phường 1 cũ" -> "Khu vực Phường 1").
-- Chỉ đổi cách gọi hiển thị; mã khu vực (XH-P1 …) và ranh giới giữ nguyên.
BEGIN;

UPDATE service_areas
SET name = regexp_replace(name, ' cũ$', ''),
    description = CASE WHEN description IS NULL THEN NULL ELSE regexp_replace(description, '(Phường [0-9]+) cũ', '\1', 'g') END
WHERE name ~ ' cũ$' OR description ~ 'Phường [0-9]+ cũ';

COMMIT;
