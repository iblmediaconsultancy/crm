\set ON_ERROR_STOP on
BEGIN READ ONLY;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT "id" FROM "lead" WHERE "ownerUserId" = :'owner_user_id' AND "status" = 'NEW' ORDER BY "updatedAt" DESC LIMIT 50;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT "id" FROM "operationalTask" WHERE "assigneeUserId" = :'owner_user_id' AND "status" = 'TODO' ORDER BY "dueAt" NULLS LAST LIMIT 50;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT "id" FROM "researchRequest" WHERE "status" = 'QUEUED' AND ("retryAt" IS NULL OR "retryAt" <= NOW()) AND ("leasedUntil" IS NULL OR "leasedUntil" < NOW()) LIMIT 25;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT "id" FROM "mailboxSync" WHERE "status" IN ('IDLE', 'FAILED') AND ("retryAfter" IS NULL OR "retryAfter" <= NOW()) LIMIT 25;
ROLLBACK;
