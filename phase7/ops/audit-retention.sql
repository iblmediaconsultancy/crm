\set ON_ERROR_STOP on
\if :{?retention_days}
\else
  \set retention_days 400
\endif
BEGIN;
WITH removed AS (
  DELETE FROM "securityAuditEvent"
  WHERE "createdAt" < NOW() - make_interval(days => :retention_days)
  RETURNING 1
)
SELECT 'securityAuditEvent' AS table_name, count(*) AS removed FROM removed;
WITH removed AS (
  DELETE FROM "domainAuditEvent"
  WHERE "createdAt" < NOW() - make_interval(days => :retention_days)
  RETURNING 1
)
SELECT 'domainAuditEvent' AS table_name, count(*) AS removed FROM removed;
COMMIT;
