-- DỮ LIỆU MẪU ĐỂ TRÌNH DIỄN (chỉ dùng cho CSDL cục bộ / máy demo, KHÔNG nạp lên máy chủ chính thức).
--
-- Tạo sẵn: 180 tài khoản người dân (126 đã xác minh email), 236 thiết bị đã cài app, 96 phản ánh ở 3 phường thí điểm
-- (Xuân Hương, Xuân Trường, Lâm Viên) với lịch sử xử lý đầy đủ, đánh giá hài lòng và 3 ý kiến mẫu.
-- Mọi dòng mẫu đều có tiền tố "demo-seed-" (hoặc DEMO-PA-, is_demo = true) để xóa gọn bằng demo-mock-data-remove.sql.
-- Chạy lại được nhiều lần: mỗi lần chạy xóa bộ mẫu cũ rồi tạo lại, không nhân đôi.
-- Cần đã áp dụng migration 017 (email người dân) và 019 (bảng ý kiến công khai).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.public_testimonials') IS NULL THEN
    RAISE EXCEPTION 'Chua ap dung migration 019_public_stats.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'citizen_accounts' AND column_name = 'email_verified_at') THEN
    RAISE EXCEPTION 'Chua ap dung migration 017_citizen_email_recovery.sql';
  END IF;
END $$;

-- 1) Xóa bộ mẫu cũ (nếu có)
DELETE FROM incident_reports WHERE citizen_external_id LIKE 'demo-seed-%';
DELETE FROM app_ratings WHERE citizen_external_id LIKE 'demo-seed-%';
DELETE FROM push_devices WHERE token LIKE 'demo-seed-%';
DELETE FROM citizen_accounts WHERE id LIKE 'demo-seed-%';
DELETE FROM public_testimonials WHERE is_demo;

-- 2) Tài khoản người dân mẫu (không đăng nhập được: mã băm không hợp lệ)
INSERT INTO citizen_accounts (
  id, username, username_normalized, display_name, password_hash, status,
  last_login_at, created_at, updated_at, email, email_normalized, email_verified_at
)
SELECT 'demo-seed-c' || lpad(g::text, 3, '0'),
       '0900' || lpad(g::text, 6, '0'),
       '0900' || lpad(g::text, 6, '0'),
       (ARRAY['Nguyễn','Trần','Lê','Phạm','Hoàng','Võ','Đặng','Bùi','Đỗ','Ngô'])[(g * 7) % 10 + 1] || ' ' ||
       (ARRAY['Văn','Thị','Minh','Quốc','Ngọc','Hữu','Thanh','Gia'])[(g * 3) % 8 + 1] || ' ' ||
       (ARRAY['An','Bình','Châu','Dũng','Hà','Hải','Hạnh','Hùng','Lan','Linh','Mai','Nam','Phúc','Quân','Thảo','Trang','Tuấn','Vy'])[(g * 5) % 18 + 1],
       'demo-seed-khong-dang-nhap-duoc',
       'active',
       now() - ((g * 17) % 10) * interval '1 day',
       now() - (1 + (g * 37) % 40) * interval '1 day',
       now(),
       CASE WHEN g % 10 < 7 THEN 'demo.nguoidan' || g || '@example.invalid' END,
       CASE WHEN g % 10 < 7 THEN 'demo.nguoidan' || g || '@example.invalid' END,
       CASE WHEN g % 10 < 7 THEN now() - ((g * 11) % 30) * interval '1 day' END
FROM generate_series(1, 180) AS g;

-- 3) Thiết bị đã cài app (mã thiết bị giả, không gửi được thông báo thật)
INSERT INTO push_devices (token, citizen_id, area_codes, created_at, updated_at)
SELECT 'demo-seed-device-' || md5(g::text) || md5((g + 1)::text),
       CASE WHEN g <= 180 THEN 'demo-seed-c' || lpad(g::text, 3, '0') END,
       ARRAY[(ARRAY['24781','24805','24778'])[g % 3 + 1]],
       now() - (1 + (g * 29) % 40) * interval '1 day',
       now()
FROM generate_series(1, 236) AS g;

-- 4) Phản ánh mẫu ở 3 phường thí điểm
WITH tpl(cat, var, summary, description) AS (
  VALUES
    ('security', 0, 'Nhóm thanh niên tụ tập gây ồn sau 23 giờ', 'Khoảng 23 giờ có nhóm thanh niên tụ tập, nẹt pô gây mất ngủ cho các hộ xung quanh.'),
    ('security', 1, 'Phát hiện đối tượng lạ lảng vảng trước nhà', 'Có người lạ đi lại nhiều lần trước dãy nhà vào buổi tối, đề nghị cán bộ kiểm tra.'),
    ('security', 2, 'Mất xe máy trước cổng chợ', 'Tôi dựng xe gần cổng chợ khoảng 30 phút, quay lại thì không thấy xe, nhờ hỗ trợ xác minh camera.'),
    ('traffic', 0, 'Xe đỗ lấn vỉa hè khu vực chợ', 'Nhiều xe ô tô đỗ chiếm hết vỉa hè đoạn gần chợ, người đi bộ phải xuống lòng đường.'),
    ('traffic', 1, 'Đèn tín hiệu giao thông ngã tư không hoạt động', 'Đèn tại ngã tư gần trường học tắt từ sáng, giờ tan học rất dễ xảy ra va chạm.'),
    ('traffic', 2, 'Xe tải chạy quá tốc độ qua khu dân cư', 'Buổi sáng sớm xe tải chạy rất nhanh qua đoạn có nhiều trẻ em đi học.'),
    ('public_order', 0, 'Quán karaoke hoạt động quá giờ gây ồn', 'Quán gần nhà hát nhạc lớn đến 1 giờ sáng, đã nhắc nhiều lần nhưng chưa cải thiện.'),
    ('public_order', 1, 'Bán hàng rong lấn chiếm lòng đường', 'Hàng rong dựng sạp ngay lối đi, gây ùn tắc vào giờ cao điểm.'),
    ('public_order', 2, 'Chó thả rông không rọ mõm ngoài đường', 'Có nhiều chó thả rông trong khu phố, trẻ nhỏ và người già rất lo sợ.'),
    ('administrative', 0, 'Hỏi thủ tục đăng ký tạm trú', 'Tôi mới chuyển đến địa bàn, cần biết hồ sơ và nơi nộp đăng ký tạm trú.'),
    ('administrative', 1, 'Cần hướng dẫn làm lại căn cước công dân', 'Tôi làm mất căn cước, mong được hướng dẫn thủ tục cấp lại gần nhất.'),
    ('administrative', 2, 'Đề nghị xác nhận thông tin cư trú', 'Cần giấy xác nhận thông tin cư trú để làm hồ sơ cho con đi học.'),
    ('environment', 0, 'Rác thải đổ trộm ven đường', 'Có người đổ rác xây dựng ven đường nhiều ngày, bốc mùi và cản trở giao thông.'),
    ('environment', 1, 'Khói bụi từ điểm đốt rác tự phát', 'Gần nhà có điểm đốt rác hằng đêm, khói bay vào nhà.'),
    ('environment', 2, 'Cống thoát nước bị tắc gây ngập', 'Mưa lớn nước dâng cao do cống nghẽn, mong sớm xử lý.'),
    ('other', 0, 'Đèn đường khu dân cư hỏng nhiều ngày', 'Đoạn đường hẻm tối vào ban đêm, người dân đi lại rất bất tiện.'),
    ('other', 1, 'Cây xanh nghiêng nguy cơ đổ', 'Cây lớn bên đường nghiêng sau cơn mưa, sợ đổ vào nhà dân.'),
    ('other', 2, 'Mất đồ trong khu du lịch', 'Du khách bị mất ví tại điểm tham quan, nhờ hướng dẫn trình báo.')
),
gen AS (
  SELECT g,
         (ARRAY['24781','24781','24805','24778','24781','24805','24778','24781'])[g % 8 + 1] AS loc_code,
         (ARRAY['security','traffic','public_order','administrative','environment','other'])[(g * 5) % 6 + 1] AS cat,
         (g / 6) % 3 AS var,
         (ARRAY['closed','closed','closed','closed','resolved','resolved','processing','verifying','assigned','received'])[g % 10 + 1] AS st
  FROM generate_series(1, 96) AS g
),
base AS (
  SELECT gen.*,
         now() - interval '2 hours' - ((g * 53) % 20000) * interval '1 minute'
           - CASE WHEN st IN ('resolved', 'closed') THEN interval '1 day' ELSE interval '0' END AS created_at,
         l.id AS locality_id,
         (SELECT sa.id FROM service_areas sa WHERE sa.locality_id = l.id ORDER BY sa.code
            OFFSET (g % GREATEST((SELECT count(*) FROM service_areas x WHERE x.locality_id = l.id), 1)) LIMIT 1) AS service_area_id
  FROM gen JOIN localities l ON l.code = gen.loc_code
)
INSERT INTO incident_reports (
  id, receipt_code, client_request_id, citizen_external_id, category, summary, description, location_note,
  geom, accuracy_m, locality_id, service_area_id, status, priority, operational_mode,
  received_at, resolved_at, closed_at, created_at, updated_at
)
SELECT md5('demo-seed-incident-' || b.g)::uuid,
       'DEMO-PA-' || lpad(b.g::text, 4, '0'),
       'demo-seed-req-' || b.g,
       'demo-seed-c' || lpad(((b.g * 7) % 180 + 1)::text, 3, '0'),
       b.cat, t.summary, t.description, 'Dữ liệu mẫu để trình diễn',
       ST_SetSRID(ST_GeometryN(ST_GeneratePoints(COALESCE(
         (SELECT sa.geom FROM service_areas sa WHERE sa.id = b.service_area_id),
         (SELECT bd.geom FROM boundaries bd WHERE bd.locality_id = b.locality_id)), 1), 1), 4326),
       15, b.locality_id, b.service_area_id, b.st, 'normal', 'local_sandbox',
       CASE WHEN b.st = 'submitted' THEN NULL ELSE b.created_at + (10 + (b.g * 7) % 50) * interval '1 minute' END,
       CASE WHEN b.st IN ('resolved', 'closed')
            THEN b.created_at + (10 + (b.g * 7) % 50) * interval '1 minute' + (60 + (b.g * 13) % 240) * interval '1 minute' END,
       CASE WHEN b.st = 'closed'
            THEN b.created_at + (10 + (b.g * 7) % 50) * interval '1 minute' + (90 + (b.g * 13) % 240) * interval '1 minute' END,
       b.created_at,
       b.created_at
FROM base b
JOIN tpl t ON t.cat = b.cat AND t.var = b.var;

-- 5) Lịch sử xử lý của từng phản ánh mẫu
INSERT INTO incident_status_history (incident_id, from_status, to_status, actor_id, actor_role, note, public_message, created_at)
SELECT i.id,
       CASE WHEN s.n = 1 THEN NULL ELSE (pp.p)[s.n::int - 1] END,
       s.st,
       CASE WHEN s.st = 'submitted' THEN i.citizen_external_id ELSE 'demo-seed-officer' END,
       CASE WHEN s.st = 'submitted' THEN 'citizen' ELSE 'officer' END,
       CASE s.st
         WHEN 'submitted' THEN NULL
         WHEN 'received' THEN 'CSKV đã tiếp nhận hồ sơ.'
         WHEN 'assigned' THEN 'Đã phân công cán bộ phụ trách.'
         WHEN 'verifying' THEN 'Đang xác minh thông tin tại địa bàn.'
         WHEN 'processing' THEN 'Cán bộ đang xử lý.'
         WHEN 'resolved' THEN 'Đã xử lý xong và thông tin lại cho người dân.'
         WHEN 'closed' THEN 'Đã rà soát kết quả xử lý, đóng hồ sơ.'
       END,
       true,
       CASE s.st
         WHEN 'submitted' THEN i.created_at
         WHEN 'resolved' THEN i.resolved_at
         WHEN 'closed' THEN i.closed_at
         ELSE i.received_at + (s.n::int - 2) * interval '12 minutes'
       END
FROM incident_reports i
CROSS JOIN LATERAL (
  SELECT CASE i.status
    WHEN 'submitted' THEN ARRAY['submitted']
    WHEN 'received' THEN ARRAY['submitted','received']
    WHEN 'assigned' THEN ARRAY['submitted','received','assigned']
    WHEN 'verifying' THEN ARRAY['submitted','received','assigned','verifying']
    WHEN 'processing' THEN ARRAY['submitted','received','assigned','verifying','processing']
    WHEN 'resolved' THEN ARRAY['submitted','received','assigned','verifying','processing','resolved']
    ELSE ARRAY['submitted','received','assigned','verifying','processing','resolved','closed']
  END AS p
) pp
CROSS JOIN LATERAL unnest(pp.p) WITH ORDINALITY AS s(st, n)
WHERE i.citizen_external_id LIKE 'demo-seed-%';

-- 6) Đánh giá hài lòng cho khoảng 2/3 hồ sơ đã xử lý xong
INSERT INTO satisfaction_ratings (id, incident_id, citizen_external_id, score, comment, created_at)
SELECT md5('demo-seed-rating-' || i.receipt_code)::uuid, i.id, i.citizen_external_id,
       CASE WHEN (n.k * 7 + n.k / 3) % 10 < 7 THEN 5 WHEN (n.k * 7 + n.k / 3) % 10 < 9 THEN 4 ELSE 3 END,
       (ARRAY[NULL, NULL, 'Cán bộ phản hồi nhanh, hướng dẫn rõ ràng.', 'Cảm ơn Công an đã xử lý kịp thời.'])[n.k % 4 + 1],
       COALESCE(i.closed_at, i.resolved_at) + interval '2 hours'
FROM incident_reports i
CROSS JOIN LATERAL (SELECT right(i.receipt_code, 4)::int AS k) n
WHERE i.citizen_external_id LIKE 'demo-seed-%' AND i.status IN ('resolved', 'closed') AND n.k % 3 <> 0;

-- 7) Đánh giá ứng dụng
INSERT INTO app_ratings (citizen_external_id, score, comment, created_at, updated_at)
SELECT 'demo-seed-c' || lpad(g::text, 3, '0'),
       CASE WHEN g % 5 = 0 THEN 4 ELSE 5 END,
       (ARRAY[NULL, 'Ứng dụng dễ dùng, gọi cán bộ rất nhanh.', NULL])[g % 3 + 1],
       now() - (g % 20) * interval '1 day', now()
FROM generate_series(1, 60) AS g;

-- 8) Ý kiến mẫu hiện ở trang Thống kê (đã duyệt, đánh dấu is_demo)
INSERT INTO public_testimonials (author_role, author_label, comment, score, area_code, approved, is_demo, sort_order)
VALUES
  ('citizen', 'Người dân phường Xuân Hương', 'Tôi gửi phản ánh xe đỗ lấn vỉa hè, chưa đến một giờ đã có cán bộ gọi lại. Thông báo trên ứng dụng rất tiện.', 5, '24781', true, true, 1),
  ('citizen', 'Người dân phường Xuân Trường', 'Có số điện thoại cán bộ khu vực ngay trong ứng dụng, cần gì là gọi được, không phải đến tận trụ sở.', 5, '24805', true, true, 2),
  ('officer', 'Cán bộ CSKV phường Lâm Viên', 'Phản ánh có vị trí và hình ảnh nên tôi xác minh nhanh hơn nhiều, người dân cũng theo dõi được kết quả xử lý.', NULL, '24778', true, true, 3);

COMMIT;
