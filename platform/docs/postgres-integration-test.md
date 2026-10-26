# Kiểm thử luồng ghi trên PostgreSQL thật

Bài test `platform/api/test/pg-workflows.test.ts` chạy các luồng ghi dữ liệu (rút phản ánh, "đã an toàn" của SOS, từ chối sau khi giao, chặn SOS khi địa bàn chưa có cán bộ trực, chặn cán bộ xử lý hồ sơ của người khác) trên PostgreSQL + PostGIS thật, không dùng dữ liệu giả. Mặc định bài test **bị bỏ qua**; chỉ chạy khi đặt `TEST_DATABASE_URL`.

**Không bao giờ trỏ vào database production.** Bài test tạo hồ sơ/SOS mẫu, đổi trạng thái cán bộ và thêm cán bộ `officer-b-pg`.

## Chuẩn bị database thử

1. Tạo database trống có PostGIS (ví dụ `docker compose up -d postgres` trong `platform/`, cổng 5434).
2. Áp dụng migration theo thứ tự: `001`, `002`, `003`, rồi nạp `database/seed/fixture.sql` với mã địa bàn đổi từ `DEMO-DA-LAT` thành `24781`, rồi `005` … `011`.
   - Bỏ qua `004`: file này cắt ranh giới 5 phường cũ theo dữ liệu ranh giới thật của phường (mã `24781`) nên chỉ chạy được trên bản sao dữ liệu production.
   - Phải nạp địa bàn `24781` **trước** `005`, vì `005` gắn cán bộ mẫu `officer-demo-xuan-huong` vào địa bàn này.
3. Dọn dữ liệu giữa các lần chạy (các khoá idempotency trong test là cố định):

```sql
TRUNCATE incident_reports, incident_status_history, sos_events, sos_status_history,
  workflow_audit_events, incident_messages, workflow_outbox, workflow_notifications,
  incident_attachments CASCADE;
DELETE FROM workflow_actors WHERE id = 'officer-b-pg';
UPDATE workflow_actors SET active = true;
```

## Chạy

```bash
cd platform/api
TEST_DATABASE_URL=postgres://cskv:cskv_local@127.0.0.1:5434/cskv NODE_ENV=test npx vitest run test/pg-workflows.test.ts
```
