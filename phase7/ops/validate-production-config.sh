#!/bin/sh
set -eu

image_variables="POSTGRES_17_IMAGE CLAMAV_IMAGE PROMETHEUS_IMAGE IBL_MIGRATE_IMAGE IBL_API_IMAGE IBL_WORKER_IMAGE IBL_AGENT_IMAGE IBL_APP_IMAGE"
secret_variables="POSTGRES_SUPERUSER_PASSWORD_FILE MIGRATION_DB_PASSWORD_FILE API_DB_PASSWORD_FILE WORKER_DB_PASSWORD_FILE AGENT_DB_PASSWORD_FILE APP_DB_PASSWORD_FILE BACKUP_DB_PASSWORD_FILE BETTER_AUTH_SECRET_FILE CRON_SECRET_FILE AGENT_BRIDGE_SECRET_FILE MIAB_MAILBOX_CREDENTIALS_FILE RESEND_API_KEY_FILE RESEND_WEBHOOK_SECRET_FILE OBJECT_STORAGE_ACCESS_KEY_FILE OBJECT_STORAGE_SECRET_KEY_FILE"

for name in $image_variables; do
  value="$(printenv "$name" || true)"
  case "$value" in
    *@sha256:????????????????????????????????????????????????????????????????) ;;
    *) echo "$name must be an immutable image reference ending in @sha256:<64 hex>" >&2; exit 1 ;;
  esac
  digest="${value##*@sha256:}"
  case "$digest" in *[!0-9a-fA-F]*) echo "$name has a non-hex digest" >&2; exit 1 ;; esac
done

for name in $secret_variables; do
  path="$(printenv "$name" || true)"
  if [ -z "$path" ] || [ ! -f "$path" ] || [ ! -r "$path" ]; then
    echo "$name must name a readable secret file" >&2
    exit 1
  fi
done

case "${APP_URL:-}" in https://*) ;; *) echo "APP_URL must use HTTPS" >&2; exit 1 ;; esac
case "${API_URL:-}" in https://*) ;; *) echo "API_URL must use HTTPS" >&2; exit 1 ;; esac
if env | grep -q '^REDIS_\|^REDIS_URL='; then
  echo "Redis is not part of the approved production topology" >&2
  exit 1
fi
for name in MIAB_IMAP_HOST RESEND_SYSTEM_FROM_EMAIL RESEND_OUTREACH_FROM_EMAIL OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_REGION OBJECT_STORAGE_BUCKET; do
  [ -n "$(printenv "$name" || true)" ] || { echo "$name is required" >&2; exit 1; }
done

echo '{"productionConfiguration":"valid","coordinationStore":"postgresql","redisRequired":false}'