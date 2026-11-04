-- Xóa toàn bộ dữ liệu mẫu trình diễn (tài khoản, thiết bị, phản ánh, đánh giá, ý kiến mẫu). Không đụng dữ liệu thật.
BEGIN;
DELETE FROM incident_reports WHERE citizen_external_id LIKE 'demo-seed-%';
DELETE FROM app_ratings WHERE citizen_external_id LIKE 'demo-seed-%';
DELETE FROM push_devices WHERE token LIKE 'demo-seed-%';
DELETE FROM citizen_accounts WHERE id LIKE 'demo-seed-%';
DELETE FROM public_testimonials WHERE is_demo;
COMMIT;
