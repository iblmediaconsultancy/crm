CREATE OR REPLACE FUNCTION ibl_guard_outbound_delivery() RETURNS TRIGGER
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
    JOIN "outreachAuthorization" auth ON auth."id" = d."authorizationId"
    JOIN "providerCapability" p ON p."key" = 'RESEND_OUTBOUND'
    WHERE d."id" = NEW."draftId"
      AND d."status" IN ('APPROVED', 'QUEUED', 'SENT')
      AND u."kind" = 'SYSTEM_OPERATOR'
      AND d."atlasAuthorizedAt" IS NOT NULL
      AND s."atlasLiveOutreachEnabled" = true
      AND auth."scope" = 'STANDARD_COLD_OUTREACH'
      AND auth."status" = 'ACTIVE'
      AND (auth."expiresAt" IS NULL OR auth."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
      AND p."status" = 'VERIFIED'
  );

  IF NEW."status" IN ('SENDING', 'SENT') AND NOT atlas_allowed AND NOT EXISTS (
    SELECT 1
    FROM "draft" d
    JOIN "outreachApproval" a ON a."draftId" = d."id"
    JOIN "providerCapability" p ON p."key" = 'RESEND_OUTBOUND'
    WHERE d."id" = NEW."draftId"
      AND d."status" IN ('APPROVED', 'QUEUED', 'SENT')
      AND a."status" = 'APPROVED'
      AND a."decidedById" IS NOT NULL
      AND a."decidedAt" IS NOT NULL
      AND p."status" = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'Outbound delivery requires approved human review and verified Resend' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
