#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: restore-verify.sh /backups/ibl-v2-TIMESTAMP.dump" >&2
  exit 2
fi

backup="$1"
sha256sum -c "${backup}.sha256"
export PGPASSWORD="$(cat /run/secrets/postgres_superuser_password)"
dropdb --host postgres --username ibl_v2_root --if-exists ibl_v2_restore_verify
createdb --host postgres --username ibl_v2_root ibl_v2_restore_verify
pg_restore --host postgres --username ibl_v2_root --dbname ibl_v2_restore_verify \
  --no-owner --exit-on-error "$backup"
psql --host postgres --username ibl_v2_root --dbname ibl_v2_restore_verify \
  --set=ON_ERROR_STOP=1 --tuples-only --command 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;'
dropdb --host postgres --username ibl_v2_root ibl_v2_restore_verify
echo '{"event":"restore_rehearsal_completed","status":"ok"}'
