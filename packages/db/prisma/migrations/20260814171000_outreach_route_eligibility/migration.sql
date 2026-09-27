-- Reviewers need a yes/no DNC/archive decision without gaining read access to
-- the owner's private recipient route.
CREATE FUNCTION ibl_route_allows_outreach(target_route_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "contactRoute" route
    JOIN "contact" contact ON contact."id" = route."contactId"
    LEFT JOIN "contactRouteConsent" consent ON consent."routeId" = route."id"
    WHERE route."id" = target_route_id
      AND route."type" = 'EMAIL'
      AND contact."lifecycleState" = 'ACTIVE'
      AND COALESCE(consent."status"::text, 'ALLOWED') <> 'DO_NOT_CONTACT'
  )
$$;

REVOKE ALL ON FUNCTION ibl_route_allows_outreach(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_api') THEN
    GRANT EXECUTE ON FUNCTION ibl_route_allows_outreach(TEXT) TO ibl_v2_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT EXECUTE ON FUNCTION ibl_route_allows_outreach(TEXT) TO ibl_v2_app;
  END IF;
END
$$;
