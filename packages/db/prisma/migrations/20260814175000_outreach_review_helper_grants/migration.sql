-- Every runtime role that evaluates draft_read must be able to execute its
-- boolean helper; non-human principals still receive false.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT EXECUTE ON FUNCTION ibl_can_review_draft(TEXT) TO ibl_v2_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_agent') THEN
    GRANT EXECUTE ON FUNCTION ibl_can_review_draft(TEXT) TO ibl_v2_agent;
  END IF;
END
$$;
