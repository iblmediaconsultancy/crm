#!/bin/sh
set -eu

umask 077
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="/backups/ibl-v2-${timestamp}.dump"
export PGPASSWORD="$(cat /run/secrets/backup_db_password)"

pg_dump --host postgres --username "${BACKUP_DATABASE_USER:-ibl_v2_backup}" --dbname ibl_command_center_v2 \
  --format custom --compress 9 --no-owner --file "$destination"
sha256sum "$destination" > "${destination}.sha256"
find /backups -type f -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
printf '{"event":"backup_completed","file":"%s","capturedAt":"%s"}\n' \
  "$(basename "$destination")" "$timestamp"
