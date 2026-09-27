-- Team/Admin reviewers must be able to read the pending draft they are
-- authorized to decide without gaining general access to private mailboxes.
CREATE FUNCTION ibl_can_review_draft(target_draft_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(ibl_current_workspace_role() IN ('admin', 'team'), false)
    AND EXISTS (
      SELECT 1
      FROM "outreachApproval" approval
      WHERE approval."draftId" = target_draft_id
        AND approval."status" = 'PENDING'
        AND approval."requestedById" <> ibl_current_user_id()
    )
$$;

REVOKE ALL ON FUNCTION ibl_can_review_draft(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_api') THEN
    GRANT EXECUTE ON FUNCTION ibl_can_review_draft(TEXT) TO ibl_v2_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT EXECUTE ON FUNCTION ibl_can_review_draft(TEXT) TO ibl_v2_app;
  END IF;
END
$$;

DROP POLICY draft_read ON "draft";
CREATE POLICY draft_read ON "draft" FOR SELECT
  USING (
    ("mailboxId" IS NULL AND "ownerUserId" = ibl_current_user_id())
    OR ("mailboxId" IS NOT NULL AND ibl_can_read_mailbox("mailboxId"))
    OR ibl_can_review_draft("id")
  );

DROP POLICY outreach_approval_read ON "outreachApproval";
CREATE POLICY outreach_approval_read ON "outreachApproval" FOR SELECT
  USING (
    "requestedById" = ibl_current_user_id()
    OR (
      ibl_current_workspace_role() IN ('admin', 'team')
      AND "requestedById" <> ibl_current_user_id()
      AND "status" = 'PENDING'
    )
  );
