-- Draft policies coexist with the dedicated worker policy. PostgreSQL may
-- evaluate this ownership helper even when the worker policy ultimately grants access.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT EXECUTE ON FUNCTION ibl_mailbox_owned(TEXT) TO ibl_v2_worker;
  END IF;
END
$$;