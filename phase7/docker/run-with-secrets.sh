#!/bin/sh
set -eu

database_identity="${IBL_DATABASE_IDENTITY:-app}"
if [ "$database_identity" = "migration" ]; then
  database_user="ibl_v2_migration"
  database_password="$(cat /run/secrets/migration_db_password)"
else
  database_user="ibl_v2_app"
  database_password="$(cat /run/secrets/app_db_password)"
fi

encoded_password="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$database_password")"
export DATABASE_URL="postgresql://${database_user}:${encoded_password}@postgres:5432/ibl_command_center_v2"

if [ -f /run/secrets/better_auth_secret ]; then
  export BETTER_AUTH_SECRET="$(cat /run/secrets/better_auth_secret)"
fi
if [ -f /run/secrets/cron_secret ]; then
  export CRON_SECRET="$(cat /run/secrets/cron_secret)"
fi
if [ -f /run/secrets/agent_bridge_secret ]; then
  export AGENT_BRIDGE_SECRET="$(cat /run/secrets/agent_bridge_secret)"
fi

exec "$@"

