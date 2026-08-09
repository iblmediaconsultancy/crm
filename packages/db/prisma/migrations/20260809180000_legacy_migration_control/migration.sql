-- Migration-owner-only control plane for resumable V1 imports. Runtime roles
-- receive no grants on these tables and the raw export stays outside the DB.
CREATE TABLE "legacyMigrationRun" (
  "id" TEXT PRIMARY KEY,
  "sourceSystem" TEXT NOT NULL,
  "sourceWatermark" TEXT NOT NULL,
  "manifestChecksum" TEXT NOT NULL,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('DRY_RUN', 'APPLY')),
  "status" TEXT NOT NULL CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK')),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "report" JSONB,
  UNIQUE ("sourceSystem", "sourceWatermark", "manifestChecksum", "mode")
);

CREATE TABLE "legacyMigrationOutcome" (
  "idempotencyKey" TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL REFERENCES "legacyMigrationRun"("id") ON DELETE RESTRICT,
  "sourceTable" TEXT NOT NULL,
  "sourceIdHash" TEXT NOT NULL,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('MAPPED', 'REJECTED', 'DUPLICATE_CANDIDATE')),
  "targetTable" TEXT,
  "targetId" TEXT,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("runId", "sourceTable", "sourceIdHash")
);

CREATE INDEX "legacyMigrationOutcome_runId_outcome_idx"
  ON "legacyMigrationOutcome"("runId", "outcome");

CREATE TABLE "legacyIdMap" (
  "idempotencyKey" TEXT PRIMARY KEY,
  "sourceTable" TEXT NOT NULL,
  "sourceIdHash" TEXT NOT NULL,
  "targetTable" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("sourceTable", "sourceIdHash"),
  UNIQUE ("targetTable", "targetId")
);

CREATE TABLE "legacyRollbackEntry" (
  "runId" TEXT NOT NULL REFERENCES "legacyMigrationRun"("id") ON DELETE RESTRICT,
  "sequence" BIGSERIAL,
  "targetTable" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "operation" TEXT NOT NULL CHECK ("operation" = 'DELETE_INSERTED_ROW'),
  "rolledBackAt" TIMESTAMP(3),
  PRIMARY KEY ("runId", "sequence")
);

REVOKE ALL ON "legacyMigrationRun" FROM PUBLIC;
REVOKE ALL ON "legacyMigrationOutcome" FROM PUBLIC;
REVOKE ALL ON "legacyIdMap" FROM PUBLIC;
REVOKE ALL ON "legacyRollbackEntry" FROM PUBLIC;
REVOKE ALL ON SEQUENCE "legacyRollbackEntry_sequence_seq" FROM PUBLIC;
