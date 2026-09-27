-- CreateEnum
CREATE TYPE "DurableJobStatus" AS ENUM ('PENDING', 'LEASED', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DncStatus" AS ENUM ('ALLOWED', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "FollowUpPlanStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpStepStatus" AS ENUM ('PENDING', 'LEASED', 'QUEUED', 'COMPLETED', 'CANCELLED', 'DEAD');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('QUARANTINED', 'CLEAN', 'INFECTED', 'REJECTED', 'SCAN_FAILED');

-- CreateEnum
CREATE TYPE "AllocationRequestStatus" AS ENUM ('PENDING', 'LEASED', 'ALLOCATED', 'UNALLOCATED', 'FAILED', 'DEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutboundDeliveryStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "OutboundDeliveryStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "OutboundDeliveryStatus" ADD VALUE 'COMPLAINED';
ALTER TYPE "OutboundDeliveryStatus" ADD VALUE 'REPLIED';
ALTER TYPE "OutboundDeliveryStatus" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "systemEmailJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "status" "DurableJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseOwner" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "systemEmailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contactRouteConsent" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "DncStatus" NOT NULL DEFAULT 'ALLOWED',
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contactRouteConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followUpPlan" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "sourceDraftId" TEXT,
    "status" "FollowUpPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followUpPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followUpStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStepStatus" NOT NULL DEFAULT 'PENDING',
    "draftId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseOwner" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followUpStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreachEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocationPolicy" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "allocationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocationRequest" (
    "id" TEXT NOT NULL,
    "entityType" "DomainEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "policyVersion" INTEGER,
    "status" "AllocationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "explanation" JSONB,
    "assigneeUserId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseOwner" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messageAttachment" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "contentId" TEXT,
    "disposition" TEXT,
    "byteSize" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'QUARANTINED',
    "scanCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachmentScanJob" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "status" "DurableJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseOwner" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachmentScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mimeIngestionError" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "providerUid" TEXT NOT NULL,
    "rfcMessageId" TEXT,
    "errorCode" TEXT NOT NULL,
    "detail" TEXT,
    "reprocessStatus" "DurableJobStatus" NOT NULL DEFAULT 'FAILED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mimeIngestionError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providerEvidence" (
    "id" TEXT NOT NULL,
    "capability" "ProviderCapabilityKey" NOT NULL,
    "probeKind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "configurationDigest" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providerEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "systemEmailJob_idempotencyKey_key" ON "systemEmailJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "systemEmailJob_status_retryAt_leasedUntil_idx" ON "systemEmailJob"("status", "retryAt", "leasedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "contactRouteConsent_routeId_key" ON "contactRouteConsent"("routeId");

-- CreateIndex
CREATE INDEX "contactRouteConsent_contactId_status_idx" ON "contactRouteConsent"("contactId", "status");

-- CreateIndex
CREATE INDEX "followUpPlan_contactId_status_idx" ON "followUpPlan"("contactId", "status");

-- CreateIndex
CREATE INDEX "followUpPlan_ownerUserId_status_idx" ON "followUpPlan"("ownerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "followUpStep_idempotencyKey_key" ON "followUpStep"("idempotencyKey");

-- CreateIndex
CREATE INDEX "followUpStep_status_dueAt_retryAt_leasedUntil_idx" ON "followUpStep"("status", "dueAt", "retryAt", "leasedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "followUpStep_planId_position_key" ON "followUpStep"("planId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "outreachEvent_providerEventId_key" ON "outreachEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "outreachEvent_deliveryId_occurredAt_idx" ON "outreachEvent"("deliveryId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "allocationPolicy_version_key" ON "allocationPolicy"("version");

-- CreateIndex
CREATE INDEX "allocationPolicy_active_version_idx" ON "allocationPolicy"("active", "version");

-- CreateIndex
CREATE UNIQUE INDEX "allocationRequest_idempotencyKey_key" ON "allocationRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "allocationRequest_status_retryAt_leasedUntil_idx" ON "allocationRequest"("status", "retryAt", "leasedUntil");

-- CreateIndex
CREATE INDEX "allocationRequest_entityType_entityId_status_idx" ON "allocationRequest"("entityType", "entityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messageAttachment_objectKey_key" ON "messageAttachment"("objectKey");

-- CreateIndex
CREATE INDEX "messageAttachment_mailboxId_messageId_idx" ON "messageAttachment"("mailboxId", "messageId");

-- CreateIndex
CREATE INDEX "messageAttachment_status_createdAt_idx" ON "messageAttachment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "attachmentScanJob_attachmentId_key" ON "attachmentScanJob"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "attachmentScanJob_idempotencyKey_key" ON "attachmentScanJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "attachmentScanJob_status_retryAt_leasedUntil_idx" ON "attachmentScanJob"("status", "retryAt", "leasedUntil");

-- CreateIndex
CREATE INDEX "mimeIngestionError_reprocessStatus_updatedAt_idx" ON "mimeIngestionError"("reprocessStatus", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mimeIngestionError_mailboxId_providerUid_key" ON "mimeIngestionError"("mailboxId", "providerUid");

-- CreateIndex
CREATE INDEX "providerEvidence_capability_createdAt_idx" ON "providerEvidence"("capability", "createdAt");
ALTER TABLE "systemEmailJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "systemEmailJob" FORCE ROW LEVEL SECURITY;
ALTER TABLE "contactRouteConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contactRouteConsent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "followUpPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followUpPlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "followUpStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followUpStep" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outreachEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreachEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "allocationPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allocationPolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "allocationRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allocationRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "messageAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messageAttachment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attachmentScanJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachmentScanJob" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mimeIngestionError" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mimeIngestionError" FORCE ROW LEVEL SECURITY;
ALTER TABLE "providerEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "providerEvidence" FORCE ROW LEVEL SECURITY;

CREATE POLICY system_email_actor_read ON "systemEmailJob" FOR SELECT
  USING ("actorUserId" = ibl_current_user_id() OR ibl_current_principal_kind() = 'worker');
CREATE POLICY system_email_actor_insert ON "systemEmailJob" FOR INSERT
  WITH CHECK ("actorUserId" = ibl_current_user_id());
CREATE POLICY system_email_worker_update ON "systemEmailJob" FOR UPDATE
  USING (ibl_current_principal_kind() = 'worker')
  WITH CHECK (ibl_current_principal_kind() = 'worker');

CREATE POLICY route_consent_read ON "contactRouteConsent" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "contactRoute" r
    WHERE r."id" = "routeId"
      AND (r."ownerUserId" = ibl_current_user_id() OR r."visibility" = 'SHARED')
  ));
CREATE POLICY route_consent_write ON "contactRouteConsent" FOR ALL
  USING (ibl_can_manage_crm() OR EXISTS (
    SELECT 1 FROM "contactRoute" r
    WHERE r."id" = "routeId" AND r."ownerUserId" = ibl_current_user_id()
  ))
  WITH CHECK (ibl_can_manage_crm() OR EXISTS (
    SELECT 1 FROM "contactRoute" r
    WHERE r."id" = "routeId" AND r."ownerUserId" = ibl_current_user_id()
  ));

CREATE POLICY follow_up_plan_access ON "followUpPlan" FOR ALL
  USING ("ownerUserId" = ibl_current_user_id() OR ibl_can_manage_crm() OR ibl_current_principal_kind() = 'worker')
  WITH CHECK ("ownerUserId" = ibl_current_user_id() OR ibl_can_manage_crm() OR ibl_current_principal_kind() = 'worker');
CREATE POLICY follow_up_step_access ON "followUpStep" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "followUpPlan" p WHERE p."id" = "planId"
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "followUpPlan" p WHERE p."id" = "planId"
  ));

CREATE POLICY outreach_event_read ON "outreachEvent" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "outboundDelivery" d
    JOIN "draft" f ON f."id" = d."draftId"
    WHERE d."id" = "deliveryId"
      AND (f."ownerUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
  ));
CREATE POLICY outreach_event_worker_insert ON "outreachEvent" FOR INSERT
  WITH CHECK (ibl_current_principal_kind() = 'worker');

CREATE POLICY allocation_policy_read ON "allocationPolicy" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY allocation_policy_manage ON "allocationPolicy" FOR ALL
  USING (ibl_current_workspace_role() = 'admin')
  WITH CHECK (ibl_current_workspace_role() = 'admin');
CREATE POLICY allocation_request_read ON "allocationRequest" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL OR ibl_current_principal_kind() = 'worker');
CREATE POLICY allocation_request_manage ON "allocationRequest" FOR ALL
  USING (ibl_can_manage_crm() OR ibl_current_principal_kind() = 'worker')
  WITH CHECK (ibl_can_manage_crm() OR ibl_current_principal_kind() = 'worker');

CREATE POLICY message_attachment_read ON "messageAttachment" FOR SELECT
  USING (ibl_can_read_mailbox("mailboxId") OR (
    ibl_current_principal_kind() = 'worker' AND ibl_current_mailbox_id() = "mailboxId"
  ));
CREATE POLICY message_attachment_worker_write ON "messageAttachment" FOR ALL
  USING (ibl_current_principal_kind() = 'worker')
  WITH CHECK (ibl_current_principal_kind() = 'worker');
CREATE POLICY attachment_scan_worker ON "attachmentScanJob" FOR ALL
  USING (ibl_current_principal_kind() = 'worker')
  WITH CHECK (ibl_current_principal_kind() = 'worker');
CREATE POLICY mime_error_read ON "mimeIngestionError" FOR SELECT
  USING (ibl_can_read_mailbox("mailboxId") OR (
    ibl_current_principal_kind() = 'worker' AND ibl_current_mailbox_id() = "mailboxId"
  ));
CREATE POLICY mime_error_worker_write ON "mimeIngestionError" FOR ALL
  USING (ibl_current_principal_kind() = 'worker')
  WITH CHECK (ibl_current_principal_kind() = 'worker');

CREATE POLICY provider_evidence_admin_read ON "providerEvidence" FOR SELECT
  USING (ibl_current_workspace_role() = 'admin');
CREATE POLICY provider_evidence_admin_insert ON "providerEvidence" FOR INSERT
  WITH CHECK (
    ibl_current_workspace_role() = 'admin'
    AND "operatorUserId" = ibl_current_user_id()
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_api') THEN
    GRANT USAGE ON SCHEMA public TO ibl_v2_api, ibl_v2_worker, ibl_v2_agent, ibl_v2_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ibl_v2_api;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO ibl_v2_app;
    GRANT SELECT, INSERT, UPDATE ON
      "systemEmailJob", "outboundDelivery", "followUpPlan", "followUpStep",
      "outreachEvent", "allocationRequest", "messageAttachment",
      "attachmentScanJob", "mimeIngestionError", "providerCapability",
      "providerEvidence", "mailbox", "mailboxSync", "emailThread", "emailMessage"
      TO ibl_v2_worker;
    GRANT SELECT, INSERT, UPDATE ON
      "researchRequest", "researchFinding", "agentTask", "agentEvent"
      TO ibl_v2_agent;
    GRANT EXECUTE ON FUNCTION ibl_current_user_id() TO ibl_v2_api, ibl_v2_worker, ibl_v2_agent, ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_current_mailbox_id() TO ibl_v2_api, ibl_v2_worker;
    GRANT EXECUTE ON FUNCTION ibl_current_principal_kind() TO ibl_v2_api, ibl_v2_worker, ibl_v2_agent;
    GRANT EXECUTE ON FUNCTION ibl_current_workspace_role() TO ibl_v2_api, ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_can_manage_crm() TO ibl_v2_api;
    GRANT EXECUTE ON FUNCTION ibl_can_read_mailbox(TEXT) TO ibl_v2_api, ibl_v2_worker;
  END IF;
END
$$;
CREATE POLICY outbound_delivery_worker_access ON "outboundDelivery" FOR ALL
  USING (ibl_current_principal_kind() = 'worker')
  WITH CHECK (ibl_current_principal_kind() = 'worker');
CREATE POLICY draft_worker_access ON "draft" FOR ALL
  USING (ibl_current_principal_kind() = 'worker')
  WITH CHECK (ibl_current_principal_kind() = 'worker');
CREATE POLICY mailbox_sync_worker_schedule ON "mailboxSync" FOR SELECT
  USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY contact_worker_read ON "contact" FOR SELECT
  USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY contact_route_worker_read ON "contactRoute" FOR SELECT
  USING (ibl_current_principal_kind() = 'worker');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT SELECT, UPDATE, INSERT ON "draft", "contact", "contactRoute" TO ibl_v2_worker;
  END IF;
END
$$;
DROP POLICY outreach_approval_decide ON "outreachApproval";
CREATE POLICY outreach_approval_decide ON "outreachApproval" FOR UPDATE
  USING (
    "status" = 'PENDING'
    AND ibl_current_workspace_role() IN ('admin', 'team')
    AND "requestedById" <> ibl_current_user_id()
  )
  WITH CHECK (
    "status" IN ('APPROVED', 'REJECTED')
    AND "decidedById" = ibl_current_user_id()
    AND "decidedById" <> "requestedById"
    AND "decidedAt" IS NOT NULL
  );

DROP POLICY football_player_access ON "footballPlayer";
CREATE POLICY football_player_read ON "footballPlayer" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY football_player_write ON "footballPlayer" FOR ALL
  USING (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "contact" c
      WHERE c."id" = "contactId" AND c."ownerId" = ibl_current_user_id()
    )
  )
  WITH CHECK (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "contact" c
      WHERE c."id" = "contactId" AND c."ownerId" = ibl_current_user_id()
    )
  );

DROP POLICY football_agent_access ON "footballAgent";
CREATE POLICY football_agent_read ON "footballAgent" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY football_agent_write ON "footballAgent" FOR ALL
  USING (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "contact" c
      WHERE c."id" = "contactId" AND c."ownerId" = ibl_current_user_id()
    )
  )
  WITH CHECK (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "contact" c
      WHERE c."id" = "contactId" AND c."ownerId" = ibl_current_user_id()
    )
  );

DROP POLICY agency_access ON "agency";
CREATE POLICY agency_read ON "agency" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY agency_write ON "agency" FOR ALL
  USING (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "company" c
      WHERE c."id" = "companyId" AND c."ownerId" = ibl_current_user_id()
    )
  )
  WITH CHECK (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "company" c
      WHERE c."id" = "companyId" AND c."ownerId" = ibl_current_user_id()
    )
  );

DROP POLICY club_access ON "club";
CREATE POLICY club_read ON "club" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY club_write ON "club" FOR ALL
  USING (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "company" c
      WHERE c."id" = "companyId" AND c."ownerId" = ibl_current_user_id()
    )
  )
  WITH CHECK (
    ibl_can_manage_crm()
    OR EXISTS (
      SELECT 1 FROM "company" c
      WHERE c."id" = "companyId" AND c."ownerId" = ibl_current_user_id()
    )
  );

DROP POLICY representation_access ON "representation";
CREATE POLICY representation_read ON "representation" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY representation_write ON "representation" FOR ALL
  USING ("createdByUserId" = ibl_current_user_id() OR ibl_can_manage_crm())
  WITH CHECK ("createdByUserId" = ibl_current_user_id() OR ibl_can_manage_crm());