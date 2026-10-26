ALTER TABLE "appSetting"
ADD COLUMN "atlasLinkedInExecutionMode" TEXT NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "contactRoute"
ADD COLUMN "linkedinRelationshipState" "LinkedInConnectionState",
ADD COLUMN "linkedinRelationshipVerifiedAt" TIMESTAMP(3),
ADD COLUMN "linkedinRelationshipEvidence" JSONB;

CREATE TYPE "LinkedInManualActionType" AS ENUM (
  'REPLY',
  'WARM_FOLLOW_UP',
  'CONNECTION_REQUEST',
  'FIRST_MESSAGE'
);

CREATE TYPE "LinkedInManualActionStatus" AS ENUM (
  'PREPARED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "linkedinManualAction" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "routeId" TEXT,
  "profileUrl" TEXT NOT NULL,
  "normalizedProfileUrl" TEXT NOT NULL,
  "linkedinMemberIdentifier" TEXT,
  "conversationId" TEXT,
  "type" "LinkedInManualActionType" NOT NULL,
  "status" "LinkedInManualActionStatus" NOT NULL DEFAULT 'PREPARED',
  "body" TEXT,
  "whyNow" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "occurredAt" TIMESTAMP(3),
  "completionEvidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "linkedinManualAction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "linkedinMessage"
ADD COLUMN "manualActionId" TEXT;

ALTER TABLE "activity"
ADD COLUMN "linkedinManualActionId" TEXT;

CREATE UNIQUE INDEX "linkedinManualAction_idempotencyKey_key"
ON "linkedinManualAction"("idempotencyKey");

CREATE UNIQUE INDEX "linkedinMessage_manualActionId_key"
ON "linkedinMessage"("manualActionId");

CREATE UNIQUE INDEX "activity_linkedinManualActionId_key"
ON "activity"("linkedinManualActionId");

CREATE INDEX "linkedinManualAction_status_type_createdAt_idx"
ON "linkedinManualAction"("status", "type", "createdAt");

CREATE INDEX "linkedinManualAction_contactId_status_idx"
ON "linkedinManualAction"("contactId", "status");

CREATE INDEX "linkedinManualAction_conversationId_status_idx"
ON "linkedinManualAction"("conversationId", "status");

ALTER TABLE "linkedinManualAction"
ADD CONSTRAINT "linkedinManualAction_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "linkedinManualAction_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "contactRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "linkedinManualAction_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "linkedinConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "linkedinManualAction_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "linkedinManualAction_completedByUserId_fkey"
FOREIGN KEY ("completedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "linkedinMessage"
ADD CONSTRAINT "linkedinMessage_manualActionId_fkey"
FOREIGN KEY ("manualActionId") REFERENCES "linkedinManualAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activity"
ADD CONSTRAINT "activity_linkedinManualActionId_fkey"
FOREIGN KEY ("linkedinManualActionId") REFERENCES "linkedinManualAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
