ALTER TABLE "clientFinancialProfile"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "financialSnapshot"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "companyFinancialSnapshot"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "financialEvent"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "meetingRequest"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "agentTask"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "agentEvent"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

DROP INDEX IF EXISTS "companyFinancialSnapshot_currency_periodStart_key";

CREATE UNIQUE INDEX "companyFinancialSnapshot_currency_periodStart_lifecycleState_key"
  ON "companyFinancialSnapshot"("currency", "periodStart", "lifecycleState");

CREATE INDEX "clientFinancialProfile_lifecycleState_billingStatus_idx"
  ON "clientFinancialProfile"("lifecycleState", "billingStatus");

CREATE INDEX "financialSnapshot_lifecycleState_periodStart_idx"
  ON "financialSnapshot"("lifecycleState", "periodStart");

CREATE INDEX "companyFinancialSnapshot_lifecycleState_periodStart_idx"
  ON "companyFinancialSnapshot"("lifecycleState", "periodStart");

CREATE INDEX "financialEvent_lifecycleState_occurredAt_idx"
  ON "financialEvent"("lifecycleState", "occurredAt");

CREATE INDEX "meetingRequest_lifecycleState_startsAt_idx"
  ON "meetingRequest"("lifecycleState", "startsAt");

CREATE INDEX "agentTask_lifecycleState_dueAt_idx"
  ON "agentTask"("lifecycleState", "dueAt");

CREATE INDEX "agentEvent_lifecycleState_emittedAt_idx"
  ON "agentEvent"("lifecycleState", "emittedAt");
