-- Keep the just-decided approval and draft visible to its independent reviewer
-- so PostgreSQL can atomically return the decision and transition the draft.
CREATE OR REPLACE FUNCTION ibl_can_review_draft(target_draft_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(ibl_current_workspace_role() IN ('admin', 'team'), false)
    AND EXISTS (
      SELECT 1
      FROM "outreachApproval" approval
      WHERE approval."draftId" = target_draft_id
        AND approval."requestedById" <> ibl_current_user_id()
        AND (
          approval."status" = 'PENDING'
          OR approval."decidedById" = ibl_current_user_id()
        )
    )
$$;

DROP POLICY outreach_approval_read ON "outreachApproval";
CREATE POLICY outreach_approval_read ON "outreachApproval" FOR SELECT
  USING (
    "requestedById" = ibl_current_user_id()
    OR (
      ibl_current_workspace_role() IN ('admin', 'team')
      AND "requestedById" <> ibl_current_user_id()
      AND (
        "status" = 'PENDING'
        OR "decidedById" = ibl_current_user_id()
      )
    )
  );
