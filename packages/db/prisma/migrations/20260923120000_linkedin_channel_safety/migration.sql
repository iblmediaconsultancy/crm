CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'LINKEDIN', 'WHATSAPP', 'PHONE', 'INSTAGRAM', 'OTHER');
CREATE TYPE "ChannelEngagementStatus" AS ENUM ('COLD_ELIGIBLE', 'ACTIVE_HUMAN_CONVERSATION', 'WAITING_ON_PROSPECT', 'PARKED', 'CLOSED', 'SUPPRESSED', 'NEEDS_IHSAN');
CREATE TYPE "OutreachSuppressionScope" AS ENUM ('ROUTE', 'CONTACT', 'ORGANIZATION');
CREATE TYPE "RelationshipTouchStatus" AS ENUM ('CLAIMED', 'CONSUMED', 'RELEASED');
CREATE TYPE "LinkedInConversationStatus" AS ENUM ('ACTIVE', 'WAITING_ON_PROSPECT', 'PARKED', 'CLOSED', 'NEEDS_IHSAN');
CREATE TYPE "LinkedInClassification" AS ENUM ('ACTION_REQUIRED', 'REFERRAL_OR_PLAYER_OPPORTUNITY', 'WARM_HANDOFF', 'WAITING_ON_PROSPECT', 'POSITIVE_LIGHT', 'PARKED_NO_CURRENT_NEED', 'CLOSED_OR_DO_NOT_PUSH', 'AMBIGUOUS_OR_NEEDS_IHSAN');
CREATE TYPE "LinkedInConsentStatus" AS ENUM ('UNKNOWN', 'ALLOWED', 'DO_NOT_CONTACT');
CREATE TYPE "LinkedInConnectionState" AS ENUM ('UNKNOWN', 'NOT_CONNECTED', 'PENDING_SENT', 'PENDING_RECEIVED', 'CONNECTED', 'DECLINED', 'WITHDRAWN');
CREATE TYPE "LinkedInMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "LinkedInMessageStatus" AS ENUM ('HISTORICAL', 'DRAFT', 'QUEUED', 'SENDING', 'SENT', 'RECEIVED', 'FAILED', 'AMBIGUOUS', 'CANCELLED');
CREATE TYPE "LinkedInMessageProvenance" AS ENUM ('HISTORICAL_IMPORT', 'VERIFIED_INBOX', 'WORKFLOW_EVIDENCE', 'BROWSER_CONFIRMED', 'MANUAL');
CREATE TYPE "LinkedInActionType" AS ENUM ('MESSAGE', 'CONNECTION_REQUEST');
CREATE TYPE "LinkedInJobStatus" AS ENUM ('PENDING', 'LEASED', 'WAITING_REVIEW', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'CANCELLED', 'DEAD');
CREATE TYPE "LinkedInSendAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'BLOCKED');

ALTER TABLE "lead" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "activity" ADD COLUMN "linkedinMessageId" TEXT;
ALTER TABLE "followUpPlan" ADD COLUMN "channel" "OutreachChannel" NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "followUpPlan" ADD COLUMN "linkedinConversationId" TEXT;

CREATE TABLE "linkedinConversation" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "companyId" TEXT,
  "leadId" TEXT,
  "identityKey" TEXT NOT NULL,
  "profileUrl" TEXT,
  "normalizedProfileUrl" TEXT,
  "externalConversationKey" TEXT,
  "status" "LinkedInConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "classification" "LinkedInClassification" NOT NULL DEFAULT 'AMBIGUOUS_OR_NEEDS_IHSAN',
  "consent" "LinkedInConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
  "connectionState" "LinkedInConnectionState" NOT NULL DEFAULT 'UNKNOWN',
  "lastInboundAt" TIMESTAMP(3),
  "lastOutboundAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3),
  "nextActionAt" TIMESTAMP(3),
  "nextActionTitle" TEXT,
  "browserSessionKey" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "linkedinConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "linkedinMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "direction" "LinkedInMessageDirection" NOT NULL,
  "status" "LinkedInMessageStatus" NOT NULL,
  "provenance" "LinkedInMessageProvenance" NOT NULL,
  "body" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "externalMessageKey" TEXT,
  "sourceKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "sourceTurnId" TEXT,
  "countsTowardAtlasMetrics" BOOLEAN NOT NULL DEFAULT false,
  "attributedToAtlas" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "linkedinMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "linkedinSendJob" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT,
  "action" "LinkedInActionType" NOT NULL,
  "coldOutreach" BOOLEAN NOT NULL DEFAULT true,
  "accountKey" TEXT NOT NULL DEFAULT 'default',
  "quotaDay" DATE NOT NULL DEFAULT CURRENT_DATE,
  "status" "LinkedInJobStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "actionPayload" JSONB,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "leaseOwner" TEXT,
  "leasedUntil" TIMESTAMP(3),
  "retryAt" TIMESTAMP(3),
  "browserSessionKey" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "linkedinSendJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "linkedinSendAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "LinkedInSendAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "browserSessionKey" TEXT,
  "externalMessageKey" TEXT,
  "outcome" JSONB,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "linkedinSendAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "linkedinQuota" (
  "id" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "accountKey" TEXT NOT NULL,
  "messageLimit" INTEGER NOT NULL,
  "messageReserved" INTEGER NOT NULL DEFAULT 0,
  "messageSent" INTEGER NOT NULL DEFAULT 0,
  "connectionLimit" INTEGER NOT NULL,
  "connectionReserved" INTEGER NOT NULL DEFAULT 0,
  "connectionSent" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "linkedinQuota_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "channelEngagementState" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channel" "OutreachChannel" NOT NULL,
  "status" "ChannelEngagementStatus" NOT NULL DEFAULT 'COLD_ELIGIBLE',
  "lastInboundAt" TIMESTAMP(3),
  "lastOutboundAt" TIMESTAMP(3),
  "nextActionAt" TIMESTAMP(3),
  "reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "channelEngagementState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outreachSuppression" (
  "id" TEXT NOT NULL,
  "scope" "OutreachSuppressionScope" NOT NULL,
  "channel" "OutreachChannel",
  "normalizedKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "contactId" TEXT,
  "companyId" TEXT,
  "routeId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outreachSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "relationshipColdTouchClaim" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "leadId" TEXT,
  "channel" "OutreachChannel" NOT NULL,
  "status" "RelationshipTouchStatus" NOT NULL DEFAULT 'CLAIMED',
  "idempotencyKey" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "relationshipColdTouchClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_linkedinMessageId_key" ON "activity"("linkedinMessageId");
CREATE UNIQUE INDEX "linkedinConversation_identityKey_key" ON "linkedinConversation"("identityKey");
CREATE UNIQUE INDEX "linkedinConversation_externalConversationKey_key" ON "linkedinConversation"("externalConversationKey");
CREATE UNIQUE INDEX "linkedinMessage_externalMessageKey_key" ON "linkedinMessage"("externalMessageKey");
CREATE UNIQUE INDEX "linkedinMessage_sourceKey_key" ON "linkedinMessage"("sourceKey");
CREATE UNIQUE INDEX "linkedinMessage_idempotencyKey_key" ON "linkedinMessage"("idempotencyKey");
CREATE UNIQUE INDEX "linkedinSendJob_idempotencyKey_key" ON "linkedinSendJob"("idempotencyKey");
CREATE UNIQUE INDEX "linkedinSendAttempt_jobId_attemptNumber_key" ON "linkedinSendAttempt"("jobId", "attemptNumber");
CREATE UNIQUE INDEX "linkedinQuota_day_accountKey_key" ON "linkedinQuota"("day", "accountKey");
CREATE UNIQUE INDEX "channelEngagementState_contactId_channel_key" ON "channelEngagementState"("contactId", "channel");
CREATE UNIQUE INDEX "outreachSuppression_idempotencyKey_key" ON "outreachSuppression"("idempotencyKey");
CREATE UNIQUE INDEX "relationshipColdTouchClaim_contactId_key" ON "relationshipColdTouchClaim"("contactId");
CREATE UNIQUE INDEX "relationshipColdTouchClaim_idempotencyKey_key" ON "relationshipColdTouchClaim"("idempotencyKey");

CREATE INDEX "linkedinConversation_contactId_status_idx" ON "linkedinConversation"("contactId", "status");
CREATE INDEX "linkedinConversation_leadId_status_idx" ON "linkedinConversation"("leadId", "status");
CREATE INDEX "linkedinConversation_status_nextActionAt_idx" ON "linkedinConversation"("status", "nextActionAt");
CREATE INDEX "linkedinConversation_normalizedProfileUrl_idx" ON "linkedinConversation"("normalizedProfileUrl");
CREATE INDEX "linkedinMessage_conversationId_occurredAt_idx" ON "linkedinMessage"("conversationId", "occurredAt");
CREATE INDEX "linkedinMessage_conversationId_direction_occurredAt_idx" ON "linkedinMessage"("conversationId", "direction", "occurredAt");
CREATE INDEX "linkedinMessage_status_occurredAt_idx" ON "linkedinMessage"("status", "occurredAt");
CREATE INDEX "linkedinSendJob_status_retryAt_leasedUntil_idx" ON "linkedinSendJob"("status", "retryAt", "leasedUntil");
CREATE INDEX "linkedinSendJob_conversationId_status_idx" ON "linkedinSendJob"("conversationId", "status");
CREATE INDEX "linkedinSendJob_messageId_idx" ON "linkedinSendJob"("messageId");
CREATE INDEX "linkedinSendJob_accountKey_quotaDay_status_idx" ON "linkedinSendJob"("accountKey", "quotaDay", "status");
CREATE INDEX "linkedinSendAttempt_status_createdAt_idx" ON "linkedinSendAttempt"("status", "createdAt");
CREATE INDEX "linkedinQuota_accountKey_day_idx" ON "linkedinQuota"("accountKey", "day");
CREATE INDEX "channelEngagementState_channel_status_nextActionAt_idx" ON "channelEngagementState"("channel", "status", "nextActionAt");
CREATE INDEX "channelEngagementState_contactId_status_idx" ON "channelEngagementState"("contactId", "status");
CREATE INDEX "outreachSuppression_scope_normalizedKey_idx" ON "outreachSuppression"("scope", "normalizedKey");
CREATE INDEX "outreachSuppression_contactId_scope_channel_idx" ON "outreachSuppression"("contactId", "scope", "channel");
CREATE INDEX "outreachSuppression_companyId_scope_channel_idx" ON "outreachSuppression"("companyId", "scope", "channel");
CREATE INDEX "outreachSuppression_routeId_scope_channel_idx" ON "outreachSuppression"("routeId", "scope", "channel");
CREATE INDEX "relationshipColdTouchClaim_status_channel_idx" ON "relationshipColdTouchClaim"("status", "channel");
CREATE INDEX "followUpPlan_contactId_channel_status_idx" ON "followUpPlan"("contactId", "channel", "status");
CREATE INDEX "followUpPlan_linkedinConversationId_status_idx" ON "followUpPlan"("linkedinConversationId", "status");

ALTER TABLE "activity" ADD CONSTRAINT "activity_linkedinMessageId_fkey" FOREIGN KEY ("linkedinMessageId") REFERENCES "linkedinMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "linkedinConversation" ADD CONSTRAINT "linkedinConversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "linkedinConversation" ADD CONSTRAINT "linkedinConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "linkedinConversation" ADD CONSTRAINT "linkedinConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "linkedinMessage" ADD CONSTRAINT "linkedinMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "linkedinConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "linkedinSendJob" ADD CONSTRAINT "linkedinSendJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "linkedinConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "linkedinSendJob" ADD CONSTRAINT "linkedinSendJob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "linkedinMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "linkedinSendAttempt" ADD CONSTRAINT "linkedinSendAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "linkedinSendJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channelEngagementState" ADD CONSTRAINT "channelEngagementState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outreachSuppression" ADD CONSTRAINT "outreachSuppression_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outreachSuppression" ADD CONSTRAINT "outreachSuppression_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outreachSuppression" ADD CONSTRAINT "outreachSuppression_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "contactRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "relationshipColdTouchClaim" ADD CONSTRAINT "relationshipColdTouchClaim_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "relationshipColdTouchClaim" ADD CONSTRAINT "relationshipColdTouchClaim_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "followUpPlan" ADD CONSTRAINT "followUpPlan_linkedinConversationId_fkey" FOREIGN KEY ("linkedinConversationId") REFERENCES "linkedinConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "incrementLeadVersion"() RETURNS trigger AS $$
BEGIN
  IF NEW."version" = OLD."version" THEN
    NEW."version" = OLD."version" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "lead_version_trigger"
BEFORE UPDATE ON "lead"
FOR EACH ROW
EXECUTE FUNCTION "incrementLeadVersion"();
