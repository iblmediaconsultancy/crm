-- The split API runtime role evaluates owner-scoped draft policies.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_api') THEN
    GRANT EXECUTE ON FUNCTION ibl_mailbox_owned(TEXT) TO ibl_v2_api;
  END IF;
END
$$;
