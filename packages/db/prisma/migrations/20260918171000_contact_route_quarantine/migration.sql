ALTER TABLE "contactRoute"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "contactRoute_lifecycleState_updatedAt_idx"
  ON "contactRoute"("lifecycleState", "updatedAt");
