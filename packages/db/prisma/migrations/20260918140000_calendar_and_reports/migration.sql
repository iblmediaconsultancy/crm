CREATE TYPE "MeetingRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'DECLINED', 'CONFIRMED', 'CANCELED', 'BLOCKED');

CREATE TABLE "meetingRequest" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "status" "MeetingRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
    "attendeeEmails" JSONB NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "googleEventId" TEXT,
    "availability" JSONB,
    "approvalNote" TEXT,
    "blockedReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetingRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meetingRequest_status_startsAt_idx" ON "meetingRequest"("status", "startsAt");
CREATE INDEX "meetingRequest_leadId_startsAt_idx" ON "meetingRequest"("leadId", "startsAt");
CREATE INDEX "meetingRequest_contactId_startsAt_idx" ON "meetingRequest"("contactId", "startsAt");

CREATE TABLE "atlasDailyReport" (
    "id" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "timeZone" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "emailsSent" INTEGER NOT NULL,
    "replies" INTEGER NOT NULL,
    "meetings" INTEGER NOT NULL,
    "opportunities" INTEGER NOT NULL,
    "won" INTEGER NOT NULL,
    "followUpsDue" INTEGER NOT NULL,
    "activeLeads" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atlasDailyReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "atlasDailyReport_reportDate_timeZone_key" ON "atlasDailyReport"("reportDate", "timeZone");
CREATE INDEX "atlasDailyReport_generatedAt_idx" ON "atlasDailyReport"("generatedAt");

ALTER TABLE "meetingRequest" ADD CONSTRAINT "meetingRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meetingRequest" ADD CONSTRAINT "meetingRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meetingRequest" ADD CONSTRAINT "meetingRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meetingRequest" ADD CONSTRAINT "meetingRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "mailbox" ("id", "ownerUserId", "provider", "address", "normalizedAddress", "displayName", "status", "createdAt", "updatedAt")
VALUES ('atlas-outreach-mailbox', 'atlas-operator', 'MIAB', 'outreach@iblmedia.com', 'outreach@iblmedia.com', 'IBL Media Team', 'UNVERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("normalizedAddress") DO NOTHING;

INSERT INTO "mailboxSync" ("id", "userId", "source", "mailboxId", "status", "autoCreate", "createdAt", "updatedAt")
SELECT 'atlas-outreach-mailbox-miab', 'atlas-operator', 'miab', "id", 'IDLE', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "mailbox"
WHERE "normalizedAddress" = 'outreach@iblmedia.com'
ON CONFLICT ("mailboxId", "source") DO NOTHING;
