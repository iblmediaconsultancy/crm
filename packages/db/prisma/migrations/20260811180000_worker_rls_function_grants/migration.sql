-- PostgreSQL may evaluate helper functions from all permissive RLS policies.
-- The worker receives EXECUTE only; without a user principal both helpers remain false/null.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT EXECUTE ON FUNCTION ibl_current_workspace_role() TO ibl_v2_worker;
    GRANT EXECUTE ON FUNCTION ibl_can_manage_crm() TO ibl_v2_worker;
    GRANT EXECUTE ON FUNCTION ibl_domain_entity_exists("DomainEntityType", TEXT) TO ibl_v2_worker;
  END IF;
END
$$;