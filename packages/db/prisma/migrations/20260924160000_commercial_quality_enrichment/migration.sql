ALTER TABLE "agentTask" ADD COLUMN "leadId" TEXT;

ALTER TABLE "lead"
ADD COLUMN "commercialQualityInput" JSONB,
ADD COLUMN "commercialEnrichmentStatus" TEXT,
ADD COLUMN "commercialEnrichmentReason" TEXT,
ADD COLUMN "commercialEnrichmentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "commercialEnrichmentEvidence" JSONB,
ADD COLUMN "commercialEnrichmentConfidence" TEXT,
ADD COLUMN "commercialEnrichmentNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "commercialEnrichmentEvaluatedAt" TIMESTAMP(3),
ADD COLUMN "commercialEnrichmentResult" JSONB;

CREATE INDEX "agentTask_leadId_idx" ON "agentTask"("leadId");
CREATE INDEX "lead_commercialEnrichmentStatus_commercialEnrichmentNextAttemptAt_idx"
ON "lead"("commercialEnrichmentStatus", "commercialEnrichmentNextAttemptAt");
