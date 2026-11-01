#!/usr/bin/env bash
# Sao lưu cơ sở dữ liệu DataForLife mỗi ngày, kiểm tra bản dump đọc được, giữ 14 ngày.
# Cài: /usr/local/sbin/dataforlife-backup + dataforlife-backup.service/.timer (xem docs/operations.md).
set -euo pipefail
umask 077
env_file="${DATAFORLIFE_ENV:-/opt/dataforlife/repo/platform/.env}"
dest="${DATAFORLIFE_BACKUP_DIR:-/opt/dataforlife/backups/daily}"
keep_days="${DATAFORLIFE_BACKUP_KEEP_DAYS:-14}"
url="$(grep -E '^DATABASE_URL=' "$env_file" | head -n1 | cut -d= -f2-)"
[ -n "$url" ] || { echo "Không tìm thấy DATABASE_URL trong $env_file" >&2; exit 2; }
mkdir -p "$dest"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dest/db-$stamp.dump"
pg_dump --format=custom --no-owner --file="$file.partial" "$url"
# Một bản dump không đọc được thì coi như không có sao lưu.
pg_restore --list "$file.partial" >/dev/null
mv "$file.partial" "$file"
sha256sum "$file" > "$file.sha256"
find "$dest" -maxdepth 1 -name 'db-*.dump*' -type f -mtime +"$keep_days" -delete
echo "Đã sao lưu $file ($(du -h "$file" | cut -f1))"
