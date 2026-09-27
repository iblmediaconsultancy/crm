CREATE OR REPLACE FUNCTION ibl_guard_draft_outreach() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  atlas_allowed BOOLEAN;
BEGIN
  atlas_allowed := EXISTS (
    SELECT 1
    FROM "user" u
    JOIN "appSetting" s ON s."id" = 'app'
    WHERE u."id" = NEW."ownerUserId"
      AND u."kind" = 'SYSTEM_OPERATOR'
      AND NEW."atlasAuthorizedAt" IS NOT NULL
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
