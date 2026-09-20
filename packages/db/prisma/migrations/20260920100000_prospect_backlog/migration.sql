CREATE TYPE "ProspectBacklogState" AS ENUM ('NOT_REVIEWED', 'REVIEWED', 'NEEDS_ENRICHMENT', 'ELIGIBLE', 'READY', 'CONTACTED', 'REPLIED', 'WARM', 'WITH_IHSAN', 'PARKED', 'SUPPRESSED', 'INVALID');
CREATE TYPE "ProspectBacklogEntityType" AS ENUM ('PERSON', 'COMPANY', 'PLAYER');
CREATE TYPE "ProspectBacklogMatchStatus" AS ENUM ('NONE', 'EXACT_EMAIL', 'EXACT_LINKEDIN', 'CRM_NAME_REVIEW');
CREATE TYPE "ProspectBacklogPilotStatus" AS ENUM ('PREPARED', 'REVIEW_REQUIRED');

CREATE TABLE "prospectSourceBatch" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceSheetCount" INTEGER NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospectSourceBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospectSourceRecord" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceSheet" TEXT NOT NULL,
  "originalEntityId" TEXT,
  "originalRowId" INTEGER NOT NULL,
  "rawValues" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "backlogItemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospectSourceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospectBacklogItem" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "canonicalKey" TEXT NOT NULL,
  "entityType" "ProspectBacklogEntityType" NOT NULL,
  "displayName" TEXT NOT NULL,
  "normalizedName" TEXT,
  "normalizedEmail" TEXT,
  "normalizedLinkedInUrl" TEXT,
  "agencyName" TEXT,
  "state" "ProspectBacklogState" NOT NULL DEFAULT 'NOT_REVIEWED',
  "matchStatus" "ProspectBacklogMatchStatus" NOT NULL DEFAULT 'NONE',
  "matchCandidateIds" JSONB,
  "reviewReason" TEXT,
  "crmContactId" TEXT,
  "crmCompanyId" TEXT,
  "crmLeadId" TEXT,
  "lastProcessedAt" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prospectBacklogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospectBacklogRoute" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "type" "ContactRouteType" NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "isShared" BOOLEAN NOT NULL DEFAULT false,
  "contactOnce" BOOLEAN NOT NULL DEFAULT true,
  "linkedEntityKeys" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prospectBacklogRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospectBacklogRouteLink" (
  "id" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "relationship" TEXT,
  CONSTRAINT "prospectBacklogRouteLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospectBacklogPilot" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ProspectBacklogPilotStatus" NOT NULL DEFAULT 'PREPARED',
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prospectBacklogPilot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prospectBacklogPilotItem" (
  "id" TEXT NOT NULL,
  "pilotId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "routeQuality" TEXT NOT NULL,
  "researchSummary" TEXT NOT NULL,
  "whyNow" TEXT NOT NULL,
  "playerEntryPoint" TEXT,
  "language" TEXT NOT NULL,
  "proposedSubject" TEXT NOT NULL,
  "proposedBody" TEXT NOT NULL,
  "sourceUrls" JSONB NOT NULL,
  "status" "ProspectBacklogPilotStatus" NOT NULL DEFAULT 'PREPARED',
  CONSTRAINT "prospectBacklogPilotItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prospectSourceBatch_filename_sourceHash_key" ON "prospectSourceBatch"("filename", "sourceHash");
CREATE UNIQUE INDEX "prospectSourceRecord_batchId_sourceSheet_originalRowId_key" ON "prospectSourceRecord"("batchId", "sourceSheet", "originalRowId");
CREATE UNIQUE INDEX "prospectBacklogItem_batchId_canonicalKey_key" ON "prospectBacklogItem"("batchId", "canonicalKey");
CREATE UNIQUE INDEX "prospectBacklogRoute_batchId_type_normalizedValue_key" ON "prospectBacklogRoute"("batchId", "type", "normalizedValue");
CREATE UNIQUE INDEX "prospectBacklogRouteLink_routeId_itemId_key" ON "prospectBacklogRouteLink"("routeId", "itemId");
CREATE UNIQUE INDEX "prospectBacklogPilot_batchId_name_key" ON "prospectBacklogPilot"("batchId", "name");
CREATE UNIQUE INDEX "prospectBacklogPilotItem_pilotId_itemId_key" ON "prospectBacklogPilotItem"("pilotId", "itemId");
CREATE UNIQUE INDEX "prospectBacklogPilotItem_pilotId_rank_key" ON "prospectBacklogPilotItem"("pilotId", "rank");
CREATE INDEX "prospectSourceBatch_importedAt_idx" ON "prospectSourceBatch"("importedAt");
CREATE INDEX "prospectSourceRecord_batchId_sourceSheet_idx" ON "prospectSourceRecord"("batchId", "sourceSheet");
CREATE INDEX "prospectSourceRecord_backlogItemId_idx" ON "prospectSourceRecord"("backlogItemId");
CREATE INDEX "prospectBacklogItem_batchId_state_idx" ON "prospectBacklogItem"("batchId", "state");
CREATE INDEX "prospectBacklogItem_batchId_normalizedEmail_idx" ON "prospectBacklogItem"("batchId", "normalizedEmail");
CREATE INDEX "prospectBacklogItem_batchId_normalizedLinkedInUrl_idx" ON "prospectBacklogItem"("batchId", "normalizedLinkedInUrl");
CREATE INDEX "prospectBacklogItem_batchId_matchStatus_idx" ON "prospectBacklogItem"("batchId", "matchStatus");
CREATE INDEX "prospectBacklogRoute_batchId_isShared_idx" ON "prospectBacklogRoute"("batchId", "isShared");
CREATE INDEX "prospectBacklogRouteLink_itemId_idx" ON "prospectBacklogRouteLink"("itemId");

ALTER TABLE "prospectSourceRecord" ADD CONSTRAINT "prospectSourceRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "prospectSourceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prospectSourceRecord" ADD CONSTRAINT "prospectSourceRecord_backlogItemId_fkey" FOREIGN KEY ("backlogItemId") REFERENCES "prospectBacklogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prospectBacklogItem" ADD CONSTRAINT "prospectBacklogItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "prospectSourceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prospectBacklogRoute" ADD CONSTRAINT "prospectBacklogRoute_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "prospectSourceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prospectBacklogRouteLink" ADD CONSTRAINT "prospectBacklogRouteLink_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "prospectBacklogRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prospectBacklogRouteLink" ADD CONSTRAINT "prospectBacklogRouteLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "prospectBacklogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prospectBacklogPilot" ADD CONSTRAINT "prospectBacklogPilot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "prospectSourceBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prospectBacklogPilotItem" ADD CONSTRAINT "prospectBacklogPilotItem_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "prospectBacklogPilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prospectBacklogPilotItem" ADD CONSTRAINT "prospectBacklogPilotItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "prospectBacklogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
