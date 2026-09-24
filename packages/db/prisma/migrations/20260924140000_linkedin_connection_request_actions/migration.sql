CREATE TABLE "linkedinConnectionRequestJob" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "action" "LinkedInActionType" NOT NULL DEFAULT 'CONNECTION_REQUEST',
    "profileUrl" TEXT NOT NULL,
    "profileIdentifier" TEXT NOT NULL,
    "connectionState" "LinkedInConnectionState" NOT NULL DEFAULT 'NOT_CONNECTED',
    "coldOutreach" BOOLEAN NOT NULL DEFAULT true,
    "accountKey" TEXT NOT NULL DEFAULT 'default',
    "quotaDay" DATE NOT NULL,
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
    "confirmedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "linkedinConnectionRequestJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "linkedinConnectionRequestAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "LinkedInSendAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "browserSessionKey" TEXT,
    "externalRequestKey" TEXT,
    "browserProof" JSONB,
    "outcome" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "linkedinConnectionRequestAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "activity" ADD COLUMN "linkedinConnectionRequestJobId" TEXT;

CREATE UNIQUE INDEX "linkedinConnectionRequestJob_idempotencyKey_key" ON "linkedinConnectionRequestJob"("idempotencyKey");
CREATE INDEX "linkedinConnectionRequestJob_status_retryAt_leasedUntil_idx" ON "linkedinConnectionRequestJob"("status", "retryAt", "leasedUntil");
CREATE INDEX "linkedinConnectionRequestJob_contactId_status_idx" ON "linkedinConnectionRequestJob"("contactId", "status");
CREATE INDEX "linkedinConnectionRequestJob_routeId_status_idx" ON "linkedinConnectionRequestJob"("routeId", "status");
CREATE INDEX "linkedinConnectionRequestJob_accountKey_quotaDay_status_idx" ON "linkedinConnectionRequestJob"("accountKey", "quotaDay", "status");
CREATE UNIQUE INDEX "linkedinConnectionRequestAttempt_externalRequestKey_key" ON "linkedinConnectionRequestAttempt"("externalRequestKey");
CREATE UNIQUE INDEX "linkedinConnectionRequestAttempt_jobId_attemptNumber_key" ON "linkedinConnectionRequestAttempt"("jobId", "attemptNumber");
CREATE INDEX "linkedinConnectionRequestAttempt_status_createdAt_idx" ON "linkedinConnectionRequestAttempt"("status", "createdAt");
CREATE UNIQUE INDEX "activity_linkedinConnectionRequestJobId_key" ON "activity"("linkedinConnectionRequestJobId");

ALTER TABLE "linkedinConnectionRequestJob" ADD CONSTRAINT "linkedinConnectionRequestJob_action_check" CHECK ("action" = 'CONNECTION_REQUEST');
ALTER TABLE "linkedinConnectionRequestJob" ADD CONSTRAINT "linkedinConnectionRequestJob_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "linkedinConnectionRequestJob" ADD CONSTRAINT "linkedinConnectionRequestJob_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "contactRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "linkedinConnectionRequestAttempt" ADD CONSTRAINT "linkedinConnectionRequestAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "linkedinConnectionRequestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity" ADD CONSTRAINT "activity_linkedinConnectionRequestJobId_fkey" FOREIGN KEY ("linkedinConnectionRequestJobId") REFERENCES "linkedinConnectionRequestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
