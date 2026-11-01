#!/usr/bin/env bash
# Tạo cơ sở dữ liệu thử (PostgreSQL + PostGIS) cho test tích hợp. KHÔNG trỏ vào production.
# Dùng: TEST_DB_URL=postgres://user@host:port/cskv_test ops/prepare-test-db.sh
# Thứ tự theo docs/postgres-integration-test.md: 001-003, fixture (mã 24781), rồi 005 trở đi; bỏ 004.
set -euo pipefail
url="${TEST_DB_URL:?Đặt TEST_DB_URL tới một cơ sở dữ liệu thử}"
case "$url" in *test*|*127.0.0.1*|*localhost*) ;; *) echo "Từ chối: TEST_DB_URL không giống cơ sở dữ liệu thử" >&2; exit 2;; esac
root="$(cd "$(dirname "$0")/.." && pwd)"
run() { psql -v ON_ERROR_STOP=1 -q "$url" -f "$1" >/dev/null; echo "đã áp dụng $(basename "$1")"; }
for n in 001 002 003; do run "$(ls "$root"/database/migrations/${n}_*.sql)"; done
tmp="$(mktemp)"; sed 's/DEMO-DA-LAT/24781/g' "$root/database/seed/fixture.sql" > "$tmp"; run "$tmp"; rm -f "$tmp"
for file in "$root"/database/migrations/*.sql; do
  n="$(basename "$file" | cut -c1-3)"
  if [ "$n" -ge 5 ] 2>/dev/null; then run "$file"; fi
done
