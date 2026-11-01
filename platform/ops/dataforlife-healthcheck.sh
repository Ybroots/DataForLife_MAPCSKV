#!/usr/bin/env bash
# Kiểm tra API mỗi 2 phút. Hỏng 3 lần liên tiếp thì ghi lỗi vào journal, khởi động lại API,
# và nếu có ALERT_WEBHOOK_URL (ví dụ webhook nhóm chat) thì gửi cảnh báo.
set -uo pipefail
state=/run/dataforlife-healthcheck.failures
url="${DATAFORLIFE_HEALTH_URL:-http://127.0.0.1:3001/health}"
body="$(curl -fsS --max-time 8 "$url" 2>/dev/null)"
if [ -n "$body" ] && printf '%s' "$body" | grep -q '"status":"ok"'; then
  [ -f "$state" ] && logger -t dataforlife-health "API đã hoạt động lại"
  rm -f "$state"; exit 0
fi
count=$(( $(cat "$state" 2>/dev/null || echo 0) + 1 )); echo "$count" > "$state"
logger -p user.warning -t dataforlife-health "API không phản hồi ($count lần liên tiếp)"
if [ "$count" -eq 3 ]; then
  logger -p user.err -t dataforlife-health "Khởi động lại dataforlife-api sau 3 lần hỏng"
  systemctl restart dataforlife-api || true
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS --max-time 8 -H 'Content-Type: application/json' \
      -d "{\"text\":\"bandosocskv.com: API không phản hồi 3 lần liên tiếp, đã khởi động lại lúc $(date '+%H:%M %d/%m')\"}" \
      "$ALERT_WEBHOOK_URL" >/dev/null || logger -t dataforlife-health "Không gửi được cảnh báo webhook"
  fi
fi
exit 0
