ALTER TABLE "legacyMigrationRun"
  ADD COLUMN "sourceFingerprint" TEXT,
  ADD COLUMN "planFingerprint" TEXT,
  ADD COLUMN "resultFingerprint" TEXT;

ALTER TABLE "legacyRollbackEntry"
  DROP CONSTRAINT IF EXISTS "legacyRollbackEntry_operation_check";

ALTER TABLE "legacyRollbackEntry"
  ADD COLUMN "targetKeyColumn" TEXT NOT NULL DEFAULT 'id',
  ADD COLUMN "createdByRun" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "legacyRollbackEntry"
  ADD CONSTRAINT "legacyRollbackEntry_operation_check"
  CHECK ("operation" IN ('DELETE_INSERTED_ROW', 'RESTORE_BEFORE_IMAGE', 'PRESERVE_APPEND_ONLY', 'PRESERVE_DURABLE_PARENT'));

REVOKE ALL ON "legacyMigrationRun" FROM PUBLIC;
REVOKE ALL ON "legacyRollbackEntry" FROM PUBLIC;
