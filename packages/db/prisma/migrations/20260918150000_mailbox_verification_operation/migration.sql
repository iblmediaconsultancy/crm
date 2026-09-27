CREATE OR REPLACE FUNCTION ibl_outreach_mailbox_status()
RETURNS TABLE (
  "id" TEXT,
  "address" TEXT,
  "status" "MailboxStatus",
  "verifiedAt" TIMESTAMP(3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ibl_current_workspace_role() IS NULL THEN
    RAISE EXCEPTION 'Workspace access is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT m."id", m."address", m."status", m."verifiedAt"
    FROM "mailbox" m
    WHERE m."normalizedAddress" = 'outreach@iblmedia.com'
      AND m."provider" = 'MIAB';
END;
$$;

CREATE OR REPLACE FUNCTION ibl_verify_outreach_mailbox()
RETURNS TABLE (
  "id" TEXT,
  "address" TEXT,
  "status" "MailboxStatus",
  "verifiedAt" TIMESTAMP(3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ibl_current_workspace_role() NOT IN ('admin', 'team') THEN
    RAISE EXCEPTION 'Admin or Team access is required' USING ERRCODE = '42501';
  END IF;
  UPDATE "mailbox" m
  SET "status" = 'VERIFIED',
      "verifiedAt" = COALESCE(m."verifiedAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE m."normalizedAddress" = 'outreach@iblmedia.com'
    AND m."provider" = 'MIAB'
    AND m."status" <> 'DISABLED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seeded outreach mailbox was not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT m."id", m."address", m."status", m."verifiedAt"
    FROM "mailbox" m
    WHERE m."normalizedAddress" = 'outreach@iblmedia.com'
      AND m."provider" = 'MIAB';
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    REVOKE ALL ON FUNCTION ibl_outreach_mailbox_status() FROM PUBLIC;
    REVOKE ALL ON FUNCTION ibl_verify_outreach_mailbox() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ibl_outreach_mailbox_status() TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_verify_outreach_mailbox() TO ibl_v2_app;
  END IF;
END
$$;
