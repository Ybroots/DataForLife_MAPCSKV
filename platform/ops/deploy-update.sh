#!/usr/bin/env bash
# Cập nhật bản web + API trên VPS từ GitHub, theo đúng cách các lần phát hành trước (VPS tự kéo mã, tự build bằng Node 22).
# Dùng (root): bash deploy-update.sh <nhánh> <mã commit 40 ký tự>
#   ví dụ:      bash /root/deploy-update.sh dataforlife 0123456789abcdef0123456789abcdef01234567
# Việc của script: kiểm tra -> sao lưu (CSDL, web, API, .env, nginx) -> kéo mã (chỉ fast-forward) -> typecheck/test/build
#   -> áp dụng migration 015-019 (an toàn khi chạy lại) -> khởi động lại API -> đăng web mới (index.html sau cùng) -> kiểm tra.
# Hỏng bước nào trước khi đăng web thì dừng, không đổi gì trên site đang chạy. KHÔNG nạp dữ liệu mẫu trình diễn.
set -Eeuo pipefail
umask 027

BRANCH="${1:?Thieu ten nhanh. Dung: bash deploy-update.sh <nhanh> <commit>}"
COMMIT="${2:?Thieu ma commit 40 ky tu}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "Ma commit phai la 40 ky tu 0-9 a-f"; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Ten nhanh khong hop le"; exit 1; }

REPO=/opt/dataforlife/repo
WEB=/var/www/dataforlife
APP_USER=dataforlife
NODE=/opt/node22/bin
ENV_FILE="$REPO/platform/.env"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/opt/dataforlife/backups/update-$STAMP"
published=0
as_app() { runuser -u "$APP_USER" -- env PATH="$NODE:/usr/bin:/bin" "$@"; }

rollback() {
  status=$?
  trap - ERR
  echo "LOI (ma $status)." >&2
  if [[ "$published" == 1 && -f "$BACKUP/index.html" ]]; then
    install -m 0644 "$BACKUP/index.html" "$WEB/.index-rollback.html"
    mv -fT "$WEB/.index-rollback.html" "$WEB/index.html"
    echo "Da khoi phuc index.html cu. Neu API da khoi dong lai voi ma moi, xem huong dan khoi phuc o cuoi tai lieu." >&2
  fi
  echo "Sao luu: $BACKUP" >&2
  exit "$status"
}
trap rollback ERR

echo "== 0/8 Kiem tra truoc"
[[ "$(id -u)" -eq 0 ]] || { echo "Hay chay bang root."; exit 1; }
[[ "$(readlink -f "$REPO")" == /opt/dataforlife/repo ]]
[[ "$(readlink -f "$WEB")" == /var/www/dataforlife ]]
[[ -f "$WEB/index.html" && -f "$ENV_FILE" ]]
[[ -z "$(as_app git -C "$REPO" status --porcelain)" ]] || { echo "Kho ma tren VPS co thay doi chua commit, dung lai:"; as_app git -C "$REPO" status --short; exit 1; }
systemctl is-active --quiet dataforlife-api
curl -fsS http://127.0.0.1:3001/health >/dev/null
OLD="$(as_app git -C "$REPO" rev-parse HEAD)"
echo "   Dang chay commit: $OLD"

echo "== 1/8 Lay ma moi tu GitHub (nhanh $BRANCH)"
as_app git -C "$REPO" fetch origin "$BRANCH"
[[ "$(as_app git -C "$REPO" rev-parse "origin/$BRANCH")" == "$COMMIT" ]] || { echo "origin/$BRANCH khong phai commit $COMMIT. Da push chua? Hoac sai ma commit."; exit 1; }
as_app git -C "$REPO" merge-base --is-ancestor "$OLD" "$COMMIT" || { echo "Ban dang chay ($OLD) khong nam trong lich su cua $COMMIT nen khong the fast-forward. Dung lai, khong doi gi."; exit 1; }
CHANGED="$(as_app git -C "$REPO" diff --name-only "$OLD" "$COMMIT" || true)"
echo "   So file doi: $(echo "$CHANGED" | grep -c . || true)"

echo "== 2/8 Sao luu"
install -d -m 700 "$BACKUP"
cp -a "$WEB" "$BACKUP/web"
cp -p "$WEB/index.html" "$BACKUP/index.html"
cp -a "$REPO/platform/api/dist" "$BACKUP/api-dist"
cp -a "$ENV_FILE" "$BACKUP/platform.env"
cp -a /etc/nginx/sites-available/dataforlife "$BACKUP/nginx.conf"
runuser -u postgres -- pg_dump -Fc dataforlife > "$BACKUP/database.dump"
chmod 600 "$BACKUP/database.dump"
pg_restore --list "$BACKUP/database.dump" > "$BACKUP/database-contents.txt"
COUNTS="SELECT 'incidents',count(*) FROM incident_reports UNION ALL SELECT 'sos',count(*) FROM sos_events UNION ALL SELECT 'actors',count(*) FROM workflow_actors UNION ALL SELECT 'citizen_accounts',count(*) FROM citizen_accounts UNION ALL SELECT 'directory_entries',count(*) FROM directory_entries"
runuser -u postgres -- psql -X -At dataforlife -c "$COUNTS" > "$BACKUP/counts-before.txt"
echo "$OLD" > "$BACKUP/previous-commit.txt"
echo "   Sao luu tai $BACKUP"

echo "== 3/8 Keo ma (fast-forward)"
as_app git -C "$REPO" merge --ff-only "$COMMIT"
[[ "$(as_app git -C "$REPO" rev-parse HEAD)" == "$COMMIT" ]]

echo "== 4/8 Cai thu vien neu package-lock doi"
if echo "$CHANGED" | grep -qx 'platform/package-lock.json'; then
  as_app "$NODE/npm" ci --prefix "$REPO/platform"
else
  echo "   package-lock khong doi, bo qua"
fi

echo "== 5/8 typecheck, test, build (chua dang web, chua khoi dong lai API)"
as_app "$NODE/npm" --prefix "$REPO/platform" run typecheck
as_app "$NODE/npm" --prefix "$REPO/platform" test
as_app "$NODE/npm" --prefix "$REPO/platform" run build
[[ -s "$REPO/platform/web/dist/index.html" && -d "$REPO/platform/web/dist/assets" && -f "$REPO/platform/api/dist/server.js" ]]

echo "== 6/8 Migration 015-019 (an toan khi chay lai; chay bang tai khoan ung dung de dung chu so huu bang)"
DB_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
[[ -n "$DB_URL" ]]
for f in "$REPO"/platform/database/migrations/01[5-9]_*.sql; do
  echo "   == $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "== 7/8 Khoi dong lai API va dang web"
systemctl restart dataforlife-api
for attempt in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1 && break
  [[ "$attempt" -eq 30 ]] && { echo "API khong khoi dong duoc"; exit 1; }
  sleep 1
done
# Giữ lại các tệp assets của bản cũ cho những tab đang mở; index.html đăng sau cùng.
rsync -a --exclude=index.html --chmod=D755,F644 "$REPO/platform/web/dist/" "$WEB/"
install -m 0644 "$REPO/platform/web/dist/index.html" "$WEB/.index-next.html"
published=1
mv -fT "$WEB/.index-next.html" "$WEB/index.html"

echo "== 8/8 Kiem tra"
cmp "$WEB/index.html" "$REPO/platform/web/dist/index.html"
curl -fsS http://127.0.0.1:3001/health; echo
curl -fsS http://127.0.0.1/api/health; echo
curl -fsS http://127.0.0.1/api/v1/public/stats | head -c 400; echo
systemctl is-active dataforlife-api nginx
runuser -u postgres -- psql -X -At dataforlife -c "$COUNTS" > "$BACKUP/counts-after.txt"
echo "--- So dem truoc/sau (phan anh, SOS, tai khoan khong duoc giam):"
diff -u "$BACKUP/counts-before.txt" "$BACKUP/counts-after.txt" || true
echo "$COMMIT" > "$BACKUP/deployed-commit.txt"
echo
echo "XONG. commit=$COMMIT  sao luu=$BACKUP"
echo "Khoi phuc web+API neu can:"
echo "  rsync -a --delete $BACKUP/web/ $WEB/ ; rsync -a --delete $BACKUP/api-dist/ $REPO/platform/api/dist/ ; systemctl restart dataforlife-api"
echo "Khong tu phuc hoi toan bo CSDL len du lieu nguoi dung moi; hoi truoc."
