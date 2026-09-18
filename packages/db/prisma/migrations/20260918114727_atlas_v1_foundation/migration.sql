CREATE TYPE "UserKind" AS ENUM ('HUMAN', 'SYSTEM_OPERATOR');
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'READY', 'CONTACTED', 'REPLIED', 'QUALIFIED', 'WARM', 'MEETING', 'OPPORTUNITY', 'WON', 'LOST');
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "LeadOutcome" AS ENUM ('WON', 'LOST', 'NO_RESPONSE', 'NOT_A_FIT', 'NO_BUDGET', 'NO_TIMING', 'COMPETITOR', 'DUPLICATE', 'OTHER');
CREATE TYPE "LeadOriginChannel" AS ENUM ('MANUAL', 'EMAIL', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'PHONE', 'REFERRAL', 'IMPORT');
CREATE TYPE "LeadAttentionState" AS ENUM ('NONE', 'NEEDS_IHSAN', 'WITH_IHSAN', 'PARKED', 'SUPPRESSED');
CREATE TYPE "ContactOutreachState" AS ENUM ('ALLOWED', 'PROTECTED', 'SUPPRESSED');

ALTER TYPE "ContactRouteType" ADD VALUE 'INSTAGRAM';
ALTER TYPE "RecordSource" ADD VALUE 'REFERRAL';

ALTER TABLE "user" ADD COLUMN "kind" "UserKind" NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "contact" ADD COLUMN "outreachState" "ContactOutreachState" NOT NULL DEFAULT 'ALLOWED';
ALTER TABLE "contact" ADD COLUMN "outreachStateReason" TEXT;
ALTER TABLE "contact" ADD COLUMN "outreachStateChangedAt" TIMESTAMP(3);
ALTER TABLE "appSetting" ADD COLUMN "atlasLiveOutreachEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appSetting" ADD COLUMN "atlasWorkingTimeZone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam';
ALTER TABLE "appSetting" ADD COLUMN "atlasWorkStartMinute" INTEGER NOT NULL DEFAULT 540;
ALTER TABLE "appSetting" ADD COLUMN "atlasWorkEndMinute" INTEGER NOT NULL DEFAULT 1080;
ALTER TABLE "appSetting" ADD COLUMN "atlasReportMinute" INTEGER NOT NULL DEFAULT 1140;
ALTER TABLE "appSetting" ADD COLUMN "atlasDailyColdEmailLimit" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "appSetting" ADD COLUMN "atlasMaxFollowUps" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "appSetting" ADD COLUMN "atlasCooldownMinutes" INTEGER NOT NULL DEFAULT 2880;

ALTER TABLE "lead" ADD COLUMN "stage" "LeadStage" NOT NULL DEFAULT 'NEW';
ALTER TABLE "lead" ADD COLUMN "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "lead" ADD COLUMN "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "lead" ADD COLUMN "originChannel" "LeadOriginChannel" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "lead" ADD COLUMN "nextActionTitle" TEXT;
ALTER TABLE "lead" ADD COLUMN "outcome" "LeadOutcome";
ALTER TABLE "lead" ADD COLUMN "outcomeNote" TEXT;
ALTER TABLE "lead" ADD COLUMN "blocker" TEXT;
ALTER TABLE "lead" ADD COLUMN "attentionState" "LeadAttentionState" NOT NULL DEFAULT 'NONE';
ALTER TABLE "lead" ADD COLUMN "handoffReason" TEXT;
ALTER TABLE "lead" ADD COLUMN "handoffSummary" TEXT;
ALTER TABLE "lead" ADD COLUMN "handoffRecommendedAction" TEXT;
ALTER TABLE "lead" ADD COLUMN "handoffSuggestedResponses" JSONB;
ALTER TABLE "lead" ADD COLUMN "handoffAt" TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN "handoffDeadlineAt" TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN "ihsanTakenOverAt" TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN "lastContactedAt" TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN "lastRepliedAt" TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN "parkedUntil" TIMESTAMP(3);
ALTER TABLE "lead" ADD COLUMN "lastLanguage" TEXT;
ALTER TABLE "lead" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "activity" ADD COLUMN "leadId" TEXT;
ALTER TABLE "emailThread" ADD COLUMN "leadId" TEXT;
ALTER TABLE "draft" ADD COLUMN "leadId" TEXT;
ALTER TABLE "draft" ADD COLUMN "coldOutreach" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "draft" ADD COLUMN "language" TEXT;
ALTER TABLE "draft" ADD COLUMN "atlasAuthorizedAt" TIMESTAMP(3);
ALTER TABLE "draft" ADD COLUMN "atlasPolicyVersion" TEXT;
ALTER TABLE "followUpPlan" ADD COLUMN "leadId" TEXT;
ALTER TABLE "followUpPlan" ADD COLUMN "maxSteps" INTEGER NOT NULL DEFAULT 3;

CREATE TABLE "leadStageHistory" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "fromStage" "LeadStage",
  "toStage" "LeadStage" NOT NULL,
  "reason" TEXT,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leadStageHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outreachQuota" (
  "id" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "coldEmailLimit" INTEGER NOT NULL,
  "coldEmailReserved" INTEGER NOT NULL DEFAULT 0,
  "coldEmailSent" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outreachQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outreachQuota_day_key" ON "outreachQuota"("day");
CREATE INDEX "activity_leadId_createdAt_idx" ON "activity"("leadId", "createdAt");
CREATE INDEX "contact_outreachState_idx" ON "contact"("outreachState");
CREATE INDEX "draft_leadId_status_idx" ON "draft"("leadId", "status");
CREATE INDEX "draft_atlasAuthorizedAt_idx" ON "draft"("atlasAuthorizedAt");
CREATE INDEX "emailThread_leadId_lastMessageAt_idx" ON "emailThread"("leadId", "lastMessageAt");
CREATE INDEX "followUpPlan_leadId_status_idx" ON "followUpPlan"("leadId", "status");
CREATE INDEX "lead_ownerUserId_stage_attentionState_idx" ON "lead"("ownerUserId", "stage", "attentionState");
CREATE INDEX "lead_attentionState_nextActionAt_idx" ON "lead"("attentionState", "nextActionAt");
CREATE INDEX "lead_originChannel_idx" ON "lead"("originChannel");
CREATE INDEX "leadStageHistory_leadId_createdAt_idx" ON "leadStageHistory"("leadId", "createdAt");
CREATE INDEX "leadStageHistory_actorUserId_createdAt_idx" ON "leadStageHistory"("actorUserId", "createdAt");

ALTER TABLE "activity" ADD CONSTRAINT "activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emailThread" ADD CONSTRAINT "emailThread_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "draft" ADD CONSTRAINT "draft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "followUpPlan" ADD CONSTRAINT "followUpPlan_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leadStageHistory" ADD CONSTRAINT "leadStageHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leadStageHistory" ADD CONSTRAINT "leadStageHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "user" ("id", "name", "email", "emailVerified", "kind", "createdAt", "updatedAt")
VALUES ('atlas-operator', 'Atlas', 'atlas@iblmedia.com', true, 'SYSTEM_OPERATOR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "kind" = EXCLUDED."kind", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "userProfile" ("userId", "status", "preferredLanguage", "locale", "timeZone", "workingPreferences", "activatedAt", "createdAt", "updatedAt")
VALUES ('atlas-operator', 'ACTIVE', 'English', 'en', 'Europe/Amsterdam', '{"workingHours":"09:00-18:00","languages":["English","Dutch","Turkish"]}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("userId") DO UPDATE SET "status" = 'ACTIVE', "timeZone" = 'Europe/Amsterdam', "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
VALUES ('atlas-workspace-member', 'workspace', 'atlas-operator', 'admin', CURRENT_TIMESTAMP)
ON CONFLICT ("organizationId", "userId") DO UPDATE SET "role" = 'admin';

INSERT INTO "appSetting" ("id", "atlasLiveOutreachEnabled", "atlasWorkingTimeZone", "atlasWorkStartMinute", "atlasWorkEndMinute", "atlasReportMinute", "atlasDailyColdEmailLimit", "atlasMaxFollowUps", "atlasCooldownMinutes", "updatedAt")
VALUES ('app', false, 'Europe/Amsterdam', 540, 1080, 1140, 90, 3, 2880, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE OR REPLACE FUNCTION ibl_guard_draft_outreach() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  atlas_allowed BOOLEAN;
BEGIN
  atlas_allowed := EXISTS (
    SELECT 1
    FROM "draft" d
    JOIN "user" u ON u."id" = d."ownerUserId"
    JOIN "appSetting" s ON s."id" = 'app'
    WHERE d."id" = NEW."id"
      AND u."kind" = 'SYSTEM_OPERATOR'
      AND d."atlasAuthorizedAt" IS NOT NULL
      AND s."atlasLiveOutreachEnabled" = true
  );
  IF NEW."status" IN ('APPROVED', 'QUEUED', 'SENT') THEN
    IF NEW."mailboxId" IS NULL OR NEW."recipientRouteId" IS NULL OR NEW."approvedAt" IS NULL THEN
      RAISE EXCEPTION 'approved outreach requires a mailbox, recipient route, and approval timestamp' USING ERRCODE = '23514';
    END IF;
    IF NOT atlas_allowed AND NOT EXISTS (
      SELECT 1 FROM "outreachApproval" a
      WHERE a."draftId" = NEW."id" AND a."status" = 'APPROVED'
        AND a."decidedById" IS NOT NULL AND a."decidedAt" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'outreach requires an approved human decision or an enabled Atlas policy' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" IN ('QUEUED', 'SENT') AND NOT EXISTS (
    SELECT 1 FROM "providerCapability" p
    WHERE p."key" = 'RESEND_OUTBOUND' AND p."status" = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Resend provider capability is not verified' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'SENT' AND NEW."sentAt" IS NULL THEN
    RAISE EXCEPTION 'sent outreach requires sentAt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
