CREATE TYPE "OutboundDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'RETRY', 'FAILED');

ALTER TABLE "mailboxSync"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "lastErrorCode" TEXT;

CREATE TABLE "outboundDelivery" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "status" "OutboundDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leasedUntil" TIMESTAMP(3),
  "retryAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outboundDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outboundDelivery_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outboundDelivery_attempt_count_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "outboundDelivery_sent_check" CHECK ("status" <> 'SENT' OR ("providerMessageId" IS NOT NULL AND "sentAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "outboundDelivery_idempotencyKey_key" ON "outboundDelivery"("idempotencyKey");
CREATE INDEX "outboundDelivery_status_retryAt_leasedUntil_idx" ON "outboundDelivery"("status", "retryAt", "leasedUntil");
CREATE INDEX "outboundDelivery_draftId_createdAt_idx" ON "outboundDelivery"("draftId", "createdAt");

CREATE FUNCTION ibl_guard_outbound_delivery() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."status" IN ('SENDING', 'SENT') AND NOT EXISTS (
    SELECT 1
    FROM "draft" d
    JOIN "outreachApproval" a ON a."draftId" = d."id"
    JOIN "providerCapability" p ON p."key" = 'RESEND_OUTBOUND'
    WHERE d."id" = NEW."draftId"
      AND d."status" IN ('APPROVED', 'QUEUED', 'SENT')
      AND a."status" = 'APPROVED'
      AND a."decidedById" IS NOT NULL
      AND p."status" = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Outbound delivery requires approved human review and verified Resend' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER outbound_delivery_guard
  BEFORE INSERT OR UPDATE ON "outboundDelivery"
  FOR EACH ROW EXECUTE FUNCTION ibl_guard_outbound_delivery();

DROP POLICY email_thread_owner_write ON "emailThread";
CREATE POLICY email_thread_owner_write ON "emailThread" FOR ALL
  USING (
    EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id())
    OR (ibl_current_principal_kind() = 'worker' AND ibl_current_mailbox_id() = "mailboxId")
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id())
    OR (ibl_current_principal_kind() = 'worker' AND ibl_current_mailbox_id() = "mailboxId")
  );

DROP POLICY email_message_owner_write ON "emailMessage";
CREATE POLICY email_message_owner_write ON "emailMessage" FOR ALL
  USING (
    EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id())
    OR (ibl_current_principal_kind() = 'worker' AND ibl_current_mailbox_id() = "mailboxId")
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id())
    OR (ibl_current_principal_kind() = 'worker' AND ibl_current_mailbox_id() = "mailboxId")
  );

ALTER TABLE "outboundDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outboundDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY outbound_delivery_read ON "outboundDelivery" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "draft" d WHERE d."id" = "draftId"));
CREATE POLICY outbound_delivery_write ON "outboundDelivery" FOR ALL
  USING (EXISTS (SELECT 1 FROM "draft" d WHERE d."id" = "draftId" AND d."ownerUserId" = ibl_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "draft" d WHERE d."id" = "draftId" AND d."ownerUserId" = ibl_current_user_id()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "outboundDelivery" TO ibl_v2_app;
    REVOKE ALL ON FUNCTION ibl_guard_outbound_delivery() FROM PUBLIC;
  END IF;
END
$$;
