#!/bin/sh
set -eu

database_identity="${IBL_DATABASE_IDENTITY:?Set IBL_DATABASE_IDENTITY}"
case "$database_identity" in
  migration) database_user="ibl_v2_migration"; password_secret="migration_db_password" ;;
  api) database_user="ibl_v2_api"; password_secret="api_db_password" ;;
  worker) database_user="ibl_v2_worker"; password_secret="worker_db_password" ;;
  agent) database_user="ibl_v2_agent"; password_secret="agent_db_password" ;;
  app) database_user="ibl_v2_app"; password_secret="app_db_password" ;;
  backup) database_user="ibl_v2_backup"; password_secret="backup_db_password" ;;
  *) echo "Unknown database identity: $database_identity" >&2; exit 1 ;;
esac

database_password="$(cat "/run/secrets/$password_secret")"
encoded_password="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$database_password")"
export DATABASE_URL="postgresql://${database_user}:${encoded_password}@postgres:5432/ibl_command_center_v2"

load_secret() {
  secret_name="$1"
  variable_name="$2"
  if [ -f "/run/secrets/$secret_name" ]; then
    value="$(cat "/run/secrets/$secret_name")"
    export "$variable_name=$value"
  fi
}

expose_secret_file() {
  secret_name="$1"
  variable_name="$2"
  secret_path="/run/secrets/$secret_name"
  if [ -f "$secret_path" ]; then
    export "$variable_name=$secret_path"
  fi
}

load_secret better_auth_secret BETTER_AUTH_SECRET
load_secret cron_secret CRON_SECRET
load_secret agent_bridge_secret AGENT_BRIDGE_SECRET
expose_secret_file miab_mailbox_credentials_json MIAB_MAILBOX_CREDENTIALS_FILE
expose_secret_file resend_api_key RESEND_API_KEY_FILE
expose_secret_file resend_webhook_secret RESEND_WEBHOOK_SECRET_FILE
expose_secret_file object_storage_access_key OBJECT_STORAGE_ACCESS_KEY_FILE
expose_secret_file object_storage_secret_key OBJECT_STORAGE_SECRET_KEY_FILE

exec "$@"