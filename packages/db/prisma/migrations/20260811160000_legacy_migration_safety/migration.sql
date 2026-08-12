ALTER TABLE "legacyMigrationOutcome"
  DROP CONSTRAINT IF EXISTS "legacyMigrationOutcome_outcome_check";
ALTER TABLE "legacyMigrationOutcome"
  ADD CONSTRAINT "legacyMigrationOutcome_outcome_check"
  CHECK ("outcome" IN ('MAPPED', 'REJECTED', 'DUPLICATE_CANDIDATE', 'EXCLUDED'));

ALTER TABLE "legacyRollbackEntry"
  ADD COLUMN "targetFingerprint" TEXT,
  ADD COLUMN "beforeImage" JSONB,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "legacyMigrationCheckpoint" (
  "runId" TEXT NOT NULL REFERENCES "legacyMigrationRun"("id") ON DELETE RESTRICT,
  "batchKey" TEXT NOT NULL,
  "lastSourceIdHash" TEXT,
  "sourceFingerprint" TEXT NOT NULL,
  "targetFingerprint" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('PENDING', 'APPLIED', 'RECONCILED', 'ROLLED_BACK')),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("runId", "batchKey")
);

REVOKE ALL ON "legacyMigrationCheckpoint" FROM PUBLIC;
