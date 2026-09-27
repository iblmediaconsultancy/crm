CREATE TYPE "OutreachAuthorizationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "SentSyncStatus" AS ENUM ('PENDING', 'RETRY', 'SYNCED', 'FAILED', 'SKIPPED');

CREATE TABLE "outreachAuthorization" (
  "id" TEXT NOT NULL,
  "authorizedById" TEXT NOT NULL,
  "revokedById" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'STANDARD_COLD_OUTREACH',
  "status" "OutreachAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outreachAuthorization_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "draft" ADD COLUMN "authorizationId" TEXT;
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncStatus" "SentSyncStatus" NOT NULL DEFAULT 'SKIPPED';
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncRetryAt" TIMESTAMP(3);
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncErrorCode" TEXT;
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncAt" TIMESTAMP(3);
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncFolder" TEXT;
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncUid" TEXT;

ALTER TABLE "draft" ADD CONSTRAINT "draft_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "outreachAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outreachAuthorization" ADD CONSTRAINT "outreachAuthorization_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outreachAuthorization" ADD CONSTRAINT "outreachAuthorization_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "draft_authorizationId_status_idx" ON "draft"("authorizationId", "status");
CREATE INDEX "outboundDelivery_sentSyncStatus_sentSyncRetryAt_idx" ON "outboundDelivery"("sentSyncStatus", "sentSyncRetryAt");
CREATE INDEX "outreachAuthorization_status_expiresAt_idx" ON "outreachAuthorization"("status", "expiresAt");
CREATE INDEX "outreachAuthorization_authorizedById_status_idx" ON "outreachAuthorization"("authorizedById", "status");

ALTER TABLE "outreachAuthorization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreachAuthorization" FORCE ROW LEVEL SECURITY;
CREATE POLICY outreach_authorization_read ON "outreachAuthorization" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL OR ibl_current_principal_kind() IN ('worker', 'service'));
CREATE POLICY outreach_authorization_manage ON "outreachAuthorization" FOR ALL
  USING (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'))
  WITH CHECK (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'));

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
    JOIN "outreachAuthorization" a ON a."id" = d."authorizationId"
    WHERE d."id" = NEW."id"
      AND u."kind" = 'SYSTEM_OPERATOR'
      AND d."atlasAuthorizedAt" IS NOT NULL
      AND s."atlasLiveOutreachEnabled" = true
      AND a."scope" = 'STANDARD_COLD_OUTREACH'
      AND a."status" = 'ACTIVE'
      AND (a."expiresAt" IS NULL OR a."expiresAt" > CURRENT_TIMESTAMP)
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_api') THEN
    GRANT SELECT, INSERT, UPDATE ON "outreachAuthorization" TO ibl_v2_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT SELECT, UPDATE ON "outreachAuthorization" TO ibl_v2_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_agent') THEN
    GRANT SELECT ON "outreachAuthorization" TO ibl_v2_agent;
  END IF;
END
$$;
