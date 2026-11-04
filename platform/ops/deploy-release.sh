#!/usr/bin/env bash
# Triển khai một bản phát hành (web + API + migration) lên VPS. Chạy bằng root trên VPS (MobaXterm).
# Dùng: bash deploy-release.sh /đường/dẫn/release-YYYYMMDD.zip
#
# Bản phát hành được build trên máy Windows (VPS dùng Node 18, không đủ cho công cụ build mới) bằng build-release.ps1.
# Script này: sao lưu -> giải nén -> áp dụng migration (an toàn khi chạy lại) -> chép web và API -> khởi động lại -> kiểm tra.
# KHÔNG nạp dữ liệu mẫu trình diễn (apply-demo-data.ps1 chỉ dành cho máy demo).
set -euo pipefail

ZIP="${1:?Thieu duong dan file zip. Dung: bash deploy-release.sh /duong/dan/release.zip}"
WEB_ROOT="${WEB_ROOT:-/var/www/dataforlife}"
ENV_FILE="${ENV_FILE:-/opt/dataforlife/repo/platform/.env}"
SERVICE="${SERVICE:-dataforlife-api}"
DOMAIN="${DOMAIN:-bandosocskv.com}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="/opt/dataforlife/releases/$STAMP"
BACKUP="/opt/dataforlife/backups/release-$STAMP"

[ "$(id -u)" -eq 0 ] || { echo "Hay chay bang root (sudo -i)."; exit 1; }
[ -f "$ZIP" ] || { echo "Khong thay file $ZIP"; exit 1; }
command -v unzip >/dev/null || command -v python3 >/dev/null || { echo "Thieu unzip va python3: apt-get install -y unzip"; exit 1; }
command -v psql >/dev/null || { echo "Thieu psql."; exit 1; }

# Thư mục API đang chạy lấy từ chính dịch vụ systemd (WorkingDirectory + đường dẫn server.js, tuyệt đối hoặc tương đối), không đoán.
UNIT="$(systemctl cat "$SERVICE")"
WORKDIR="$(printf '%s\n' "$UNIT" | grep -m1 '^WorkingDirectory=' | cut -d= -f2- || true)"
EXEC_LINE="$(printf '%s\n' "$UNIT" | grep -m1 '^ExecStart=' || true)"
SERVER_JS="$(printf '%s\n' "$EXEC_LINE" | grep -oE '[^ ]*server\.js' | head -1 || true)"
[ -n "$SERVER_JS" ] || { echo "Khong tim thay server.js trong dich vu $SERVICE. ExecStart: $EXEC_LINE"; exit 1; }
case "$SERVER_JS" in
  /*) SERVER_PATH="$SERVER_JS" ;;
  *)  [ -n "$WORKDIR" ] || { echo "ExecStart dung duong dan tuong doi ($SERVER_JS) nhung dich vu khong co WorkingDirectory."; exit 1; }
      SERVER_PATH="$WORKDIR/$SERVER_JS" ;;
esac
API_DIST="$(dirname "$(realpath "$SERVER_PATH")")"
# Chốt an toàn: thư mục API phải có server.js và không bao giờ là thư mục gốc hay thư mục quá nông (script sẽ rsync --delete vào đây).
[ -f "$API_DIST/server.js" ] || { echo "Khong thay $API_DIST/server.js"; exit 1; }
case "$API_DIST" in /|/opt|/opt/*/|/root|/usr|/var|/etc|/home) echo "Thu muc API khong an toan: $API_DIST"; exit 1;; esac
[ "$(echo "$API_DIST" | tr -cd '/' | wc -c)" -ge 3 ] || { echo "Thu muc API qua nong: $API_DIST"; exit 1; }
echo "API dang chay tu: $API_DIST"
echo "Web: $WEB_ROOT"

echo "1/6 Sao luu CSDL va ban hien tai..."
if [ -x /usr/local/sbin/dataforlife-backup ]; then /usr/local/sbin/dataforlife-backup; fi
mkdir -p "$BACKUP" && chmod 700 "$BACKUP"
cp -a "$WEB_ROOT" "$BACKUP/www"
cp -a "$API_DIST" "$BACKUP/api-dist"
DB_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
[ -n "$DB_URL" ] || { echo "Khong doc duoc DATABASE_URL trong $ENV_FILE"; exit 1; }
pg_dump "$DB_URL" -Fc -f "$BACKUP/db.dump"
if command -v pg_restore >/dev/null; then pg_restore --list "$BACKUP/db.dump" >/dev/null; else echo "   (khong co pg_restore, bo qua buoc doc thu ban sao luu)"; fi
echo "   Da luu tai $BACKUP"

echo "2/6 Giai nen ban phat hanh..."
mkdir -p "$WORK"
if command -v unzip >/dev/null; then unzip -q "$ZIP" -d "$WORK"; else python3 -m zipfile -e "$ZIP" "$WORK"; fi
[ -f "$WORK/web/index.html" ] && [ -f "$WORK/api/server.js" ] || { echo "File zip khong dung cau truc (can web/index.html va api/server.js)."; exit 1; }

echo "3/6 Ap dung migration (chay lai an toan)..."
for f in "$WORK"/migrations/0*.sql; do
  case "$(basename "$f")" in 00[1-9]_*|01[0-9]_*) ;; *) continue;; esac
  n="$(basename "$f" | cut -c1-3)"
  [ "$n" -ge 15 ] || continue     # 001-014 da co tren may chu; chi ap dung tu 015
  echo "   == $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "4/6 Chep web..."
rsync -a --delete "$WORK/web/" "$WEB_ROOT/"

echo "5/6 Chep API va khoi dong lai..."
rsync -a --delete "$WORK/api/" "$API_DIST/"
systemctl restart "$SERVICE"
sleep 4

echo "6/6 Kiem tra..."
systemctl is-active "$SERVICE"
curl -fsS "https://$DOMAIN/api/health"; echo
curl -fsS "https://$DOMAIN/api/v1/public/stats" | head -c 300; echo
echo
echo "XONG. Ban sao luu: $BACKUP"
echo "Neu co su co, khoi phuc: rsync -a --delete $BACKUP/www/ $WEB_ROOT/ ; rsync -a --delete $BACKUP/api-dist/ $API_DIST/ ; systemctl restart $SERVICE"
echo "(KHONG tu phuc hoi toan bo CSDL len du lieu nguoi dung moi; hoi truoc.)"
