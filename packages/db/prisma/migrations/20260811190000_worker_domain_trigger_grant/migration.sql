-- Assignment integrity triggers call this helper under the invoking runtime role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT EXECUTE ON FUNCTION ibl_domain_entity_exists("DomainEntityType", TEXT) TO ibl_v2_worker;
  END IF;
END
$$;