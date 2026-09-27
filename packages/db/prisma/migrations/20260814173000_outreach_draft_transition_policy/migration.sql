-- The independent reviewer may only transition the exact draft covered by an
-- approval they can review; normal draft edits remain owner-only.
CREATE POLICY draft_approval_transition ON "draft" FOR UPDATE
  USING (ibl_can_review_draft("id"))
  WITH CHECK (ibl_can_review_draft("id"));
