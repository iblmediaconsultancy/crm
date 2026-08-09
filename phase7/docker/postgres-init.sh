#!/bin/sh
set -eu

migration_password="$(cat /run/secrets/migration_db_password)"
app_password="$(cat /run/secrets/app_db_password)"
backup_password="$(cat /run/secrets/backup_db_password)"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=migration_password="$migration_password" --set=app_password="$app_password" \
  --set=backup_password="$backup_password" <<-'SQL'
CREATE ROLE ibl_v2_migration LOGIN PASSWORD :'migration_password' BYPASSRLS;
CREATE ROLE ibl_v2_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
CREATE ROLE ibl_v2_backup LOGIN PASSWORD :'backup_password' BYPASSRLS;
GRANT pg_read_all_data TO ibl_v2_backup;
CREATE DATABASE ibl_command_center_v2 OWNER ibl_v2_migration;
GRANT CONNECT ON DATABASE ibl_command_center_v2 TO ibl_v2_app;
SQL
