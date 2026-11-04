-- Danh sách cán bộ Cảnh sát khu vực của 3 phường thí điểm (Xuân Hương, Xuân Trường, Lâm Viên).
-- Nguồn: danh sách do chủ dự án cung cấp ngày 03/11/2026. Chỉ đưa họ tên, cấp bậc (nếu có) và số điện thoại công khai;
-- không đưa năm sinh vì danh bạ này hiển thị công khai cho người dân.
-- Chạy lại được nhiều lần: cập nhật theo (source_system, source_id) = ('cskv_roster', ...).
BEGIN;

INSERT INTO directory_entries (
  entry_type, unit_id, locality_id, display_name, rank, role_title, phone,
  phone_normalized, visibility, source_system, source_id
)
SELECT 'officer',
       (SELECT u.id FROM police_units u
         WHERE u.locality_id = l.id AND u.unit_type = 'commune_police'
         ORDER BY u.created_at LIMIT 1),
       l.id, v.display_name, v.rank, 'Cảnh sát khu vực', v.phone, v.phone_normalized,
       'public', 'cskv_roster', v.source_id
FROM (VALUES
  ('24781', 'xuan-huong-01', 'Nguyễn Văn Tùng', NULL::text, '0972 345 246', '0972345246'),
  ('24781', 'xuan-huong-02', 'Lê Văn Nhung', NULL::text, '0979 266 099', '0979266099'),
  ('24781', 'xuan-huong-03', 'Vũ Tuấn Huy', NULL::text, '0982 255 229', '0982255229'),
  ('24781', 'xuan-huong-04', 'Lưu Đại Thành', NULL::text, '0918 692 646', '0918692646'),
  ('24781', 'xuan-huong-05', 'K Trung', NULL::text, '0901 886 746', '0901886746'),
  ('24781', 'xuan-huong-06', 'Nguyễn Văn Lợi', NULL::text, '0972 863 219', '0972863219'),
  ('24781', 'xuan-huong-07', 'Cao Đức Thanh', NULL::text, '0397 202 204', '0397202204'),
  ('24781', 'xuan-huong-08', 'Đỗ Đăng Khanh', NULL::text, '0395 622 922', '0395622922'),
  ('24781', 'xuan-huong-09', 'Chu Thanh Hoàng', NULL::text, '0838 081 081', '0838081081'),
  ('24781', 'xuan-huong-10', 'Nguyễn Tấn Viễn', NULL::text, '0868 032 019', '0868032019'),
  ('24781', 'xuan-huong-11', 'Trịnh Hồ Quang Trung', NULL::text, '0388 404 875', '0388404875'),
  ('24781', 'xuan-huong-12', 'Trần Thanh Tùng', NULL::text, '0983 101 062', '0983101062'),
  ('24781', 'xuan-huong-13', 'Vũ Mạnh Cường', NULL::text, '0898 549 386', '0898549386'),
  ('24781', 'xuan-huong-14', 'Lê Văn Đồng', NULL::text, '0967 579 423', '0967579423'),
  ('24781', 'xuan-huong-15', 'Trần Quang Vinh', NULL::text, '0376 898 086', '0376898086'),
  ('24781', 'xuan-huong-16', 'Huỳnh Quốc Nam', NULL::text, '0918 080 597', '0918080597'),
  ('24781', 'xuan-huong-17', 'Phạm Hoài Sơn', NULL::text, '0786 678 886', '0786678886'),
  ('24781', 'xuan-huong-18', 'Đoàn Minh Đức', NULL::text, '0986 033 336', '0986033336'),
  ('24781', 'xuan-huong-19', 'Nguyễn Văn Đức', NULL::text, '0913 056 579', '0913056579'),
  ('24805', 'xuan-truong-01', 'Đỗ Đức Toàn', NULL::text, '0903 978 910', '0903978910'),
  ('24805', 'xuan-truong-02', 'Nguyễn Thành Huy Hoàng', NULL::text, '0842 777 245', '0842777245'),
  ('24805', 'xuan-truong-03', 'Trần Văn Toàn', NULL::text, '0877 041 899', '0877041899'),
  ('24778', 'lam-vien-01', 'Nguyễn Ngọc Ánh', 'Đại úy', '0794 865 268', '0794865268'),
  ('24778', 'lam-vien-02', 'Cao Xuân Thái', 'Đại úy', '0975 729 225', '0975729225'),
  ('24778', 'lam-vien-03', 'Đoàn Minh Tú', 'Đại úy', '0969 555 808', '0969555808')
) AS v(locality_code, source_id, display_name, rank, phone, phone_normalized)
JOIN localities l ON l.code = v.locality_code
ON CONFLICT (source_system, source_id) DO UPDATE SET
  unit_id = EXCLUDED.unit_id,
  locality_id = EXCLUDED.locality_id,
  display_name = EXCLUDED.display_name,
  rank = EXCLUDED.rank,
  role_title = EXCLUDED.role_title,
  phone = EXCLUDED.phone,
  phone_normalized = EXCLUDED.phone_normalized,
  visibility = EXCLUDED.visibility,
  updated_at = now();

COMMIT;
