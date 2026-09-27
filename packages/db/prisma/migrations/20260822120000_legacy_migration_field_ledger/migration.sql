ALTER TABLE "legacyIdMap"
  DROP CONSTRAINT IF EXISTS "legacyIdMap_targetTable_targetId_key";

CREATE TABLE "legacyMigrationFieldLedger" (
  "idempotencyKey" TEXT PRIMARY KEY REFERENCES "legacyMigrationOutcome"("idempotencyKey") ON DELETE RESTRICT,
  "runId" TEXT NOT NULL REFERENCES "legacyMigrationRun"("id") ON DELETE RESTRICT,
  "sourceTable" TEXT NOT NULL,
  "sourceIdHash" TEXT NOT NULL,
  "targetTable" TEXT,
  "targetId" TEXT,
  "sourceSnapshot" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "fieldCoverage" JSONB NOT NULL,
  "targetSnapshot" JSONB,
  "targetFingerprint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("runId", "sourceTable", "sourceIdHash")
);

CREATE INDEX "legacyMigrationFieldLedger_runId_target_idx"
  ON "legacyMigrationFieldLedger"("runId", "targetTable", "targetId");

REVOKE ALL ON "legacyMigrationFieldLedger" FROM PUBLIC;
