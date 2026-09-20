CREATE TYPE "ProspectBacklogEnrichmentStatus" AS ENUM ('COMPLETED', 'DEFERRED', 'REJECTED');
CREATE TYPE "ProspectBacklogTier" AS ENUM ('A', 'B', 'C');

ALTER TABLE "prospectBacklogItem"
ADD COLUMN "lastEnrichedAt" TIMESTAMP(3),
ADD COLUMN "routeConfidence" TEXT,
ADD COLUMN "researchConfidence" TEXT,
ADD COLUMN "commercialPriority" "LeadPriority",
ADD COLUMN "tier" "ProspectBacklogTier",
ADD COLUMN "enrichmentNotes" TEXT,
ADD COLUMN "enrichmentEvidence" JSONB;

CREATE TABLE "prospectBacklogEnrichment" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "runLabel" TEXT NOT NULL,
  "status" "ProspectBacklogEnrichmentStatus" NOT NULL,
  "routeConfidence" TEXT,
  "researchConfidence" TEXT,
  "commercialPriority" "LeadPriority",
  "tier" "ProspectBacklogTier",
  "playerEntryPoint" TEXT,
  "hookType" "ProspectBacklogHookType",
  "whyNow" TEXT,
  "notes" TEXT,
  "missingReason" TEXT,
  "sourceUrls" JSONB,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospectBacklogEnrichment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prospectBacklogItem_batchId_tier_commercialPriority_idx" ON "prospectBacklogItem"("batchId", "tier", "commercialPriority");
CREATE INDEX "prospectBacklogEnrichment_itemId_createdAt_idx" ON "prospectBacklogEnrichment"("itemId", "createdAt");
CREATE INDEX "prospectBacklogEnrichment_runLabel_status_idx" ON "prospectBacklogEnrichment"("runLabel", "status");

ALTER TABLE "prospectBacklogEnrichment" ADD CONSTRAINT "prospectBacklogEnrichment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "prospectBacklogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
