# Vận hành: sao lưu, kiểm tra sức khỏe, CI

Ngày: 2026-11-01. Các tệp nằm trong `platform/ops/` và `.github/workflows/platform-ci.yml`. Chưa cài lên máy chủ.

## Sao lưu cơ sở dữ liệu mỗi đêm

`dataforlife-backup.sh` đọc `DATABASE_URL` trong `/opt/dataforlife/repo/platform/.env`, chạy `pg_dump` dạng custom,
kiểm tra bản dump đọc được bằng `pg_restore --list`, ghi kèm SHA-256 và xóa bản cũ hơn 14 ngày.
Bản sao lưu nằm ở `/opt/dataforlife/backups/daily`, quyền chỉ chủ sở hữu đọc được.

```bash
sudo install -m 750 platform/ops/dataforlife-backup.sh /usr/local/sbin/dataforlife-backup
sudo install -m 644 platform/ops/dataforlife-backup.service platform/ops/dataforlife-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dataforlife-backup.timer
sudo systemctl start dataforlife-backup.service && sudo journalctl -u dataforlife-backup -n 5
```

Bản sao lưu cùng máy chủ không chống được mất máy chủ: nên chép thêm ra nơi khác (ổ của đơn vị hoặc kho lưu trữ đối tượng).
Mỗi tháng thử khôi phục một bản vào cơ sở dữ liệu tạm: `createdb cskv_restore_test && pg_restore -d cskv_restore_test <tệp>`.

## Kiểm tra sức khỏe API mỗi 2 phút

`dataforlife-healthcheck.sh` gọi `http://127.0.0.1:3001/health`. Hỏng 3 lần liên tiếp thì ghi lỗi vào journal và khởi động lại
`dataforlife-api`. Muốn nhận cảnh báo, đặt `ALERT_WEBHOOK_URL=<webhook nhóm chat>` trong `/etc/dataforlife/healthcheck.env` (quyền 600).

```bash
sudo install -m 750 platform/ops/dataforlife-healthcheck.sh /usr/local/sbin/dataforlife-healthcheck
sudo install -m 644 platform/ops/dataforlife-healthcheck.service platform/ops/dataforlife-healthcheck.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dataforlife-healthcheck.timer
journalctl -t dataforlife-health -n 20
```

## CI trên GitHub

`.github/workflows/platform-ci.yml` (bản gốc ở `platform/ops/github/platform-ci.yml`; chép vào `.github/workflows/` ở gốc repo vì công cụ của tôi không được ghi vào thư mục `.github`) chạy khi đẩy mã lên nhánh `dataforlife` hoặc `main`, hoặc khi mở pull request:
typecheck, toàn bộ test, build web và API; job thứ hai dựng PostgreSQL + PostGIS tạm, áp dụng migration bằng
`ops/prepare-test-db.sh` và chạy cả test tích hợp. Không dùng khóa hay dữ liệu production.

## Cơ sở dữ liệu thử ở máy cá nhân

```bash
TEST_DB_URL=postgres://cskv:cskv_local@127.0.0.1:5434/cskv_test bash platform/ops/prepare-test-db.sh
```
Script từ chối URL không chứa `test`, `localhost` hoặc `127.0.0.1` để tránh chạy nhầm vào production.
