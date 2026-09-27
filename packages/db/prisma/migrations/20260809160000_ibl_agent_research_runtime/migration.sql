-- Durable, mailbox-aware Eve research queue. Workers may claim and settle queue
-- rows, while all domain reads and writes continue under the owning user context.
ALTER TABLE "researchRequest"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leasedUntil" TIMESTAMP(3),
  ADD COLUMN "retryAt" TIMESTAMP(3),
  ADD COLUMN "continuationToken" TEXT;

CREATE INDEX "researchRequest_status_retryAt_leasedUntil_idx"
  ON "researchRequest"("status", "retryAt", "leasedUntil");

CREATE POLICY research_request_worker_read ON "researchRequest" FOR SELECT
  USING (current_setting('ibl.principal_kind', true) = 'worker');

CREATE POLICY research_request_worker_update ON "researchRequest" FOR UPDATE
  USING (current_setting('ibl.principal_kind', true) = 'worker')
  WITH CHECK (current_setting('ibl.principal_kind', true) = 'worker');

ALTER TABLE "researchRequest" ADD CONSTRAINT research_request_lease_shape_check
  CHECK (
    ("leaseOwner" IS NULL AND "leasedUntil" IS NULL)
    OR ("leaseOwner" IS NOT NULL AND "leasedUntil" IS NOT NULL)
  );

ALTER TABLE "researchRequest" ADD CONSTRAINT research_request_attempt_count_check
  CHECK ("attemptCount" >= 0);
