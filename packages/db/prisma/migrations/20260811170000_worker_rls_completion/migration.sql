-- Complete the least-privilege PostgreSQL worker boundary.
CREATE POLICY allocation_policy_worker_read ON "allocationPolicy" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY route_consent_worker_read ON "contactRouteConsent" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY assignment_worker_access ON "assignment" FOR ALL USING (ibl_current_principal_kind() = 'worker') WITH CHECK (ibl_current_principal_kind() = 'worker');
CREATE POLICY company_worker_read ON "company" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY deal_worker_read ON "deal" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY lead_worker_read ON "lead" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY football_player_worker_read ON "footballPlayer" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY football_agent_worker_read ON "footballAgent" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY agency_worker_read ON "agency" FOR SELECT USING (ibl_current_principal_kind() = 'worker');
CREATE POLICY club_worker_read ON "club" FOR SELECT USING (ibl_current_principal_kind() = 'worker');

-- Upgrade paths also receive confirmation-bound canonical delete policies.
DROP POLICY IF EXISTS company_delete ON "company";
CREATE POLICY company_delete ON "company" FOR DELETE USING (
  ibl_current_workspace_role() = 'admin' AND EXISTS (
    SELECT 1 FROM "destructiveConfirmation" c WHERE c."entityType" = 'COMPANY' AND c."entityId" = "company"."id"
      AND c."entityVersion" = "company"."version" AND c."requestedByUserId" = ibl_current_user_id()
      AND c."consumedAt" IS NOT NULL AND c."expiresAt" >= NOW()
  )
);
DROP POLICY IF EXISTS contact_delete ON "contact";
CREATE POLICY contact_delete ON "contact" FOR DELETE USING (
  ibl_current_workspace_role() = 'admin' AND EXISTS (
    SELECT 1 FROM "destructiveConfirmation" c WHERE c."entityType" = 'CONTACT' AND c."entityId" = "contact"."id"
      AND c."entityVersion" = "contact"."version" AND c."requestedByUserId" = ibl_current_user_id()
      AND c."consumedAt" IS NOT NULL AND c."expiresAt" >= NOW()
  )
);
DROP POLICY IF EXISTS deal_delete ON "deal";
CREATE POLICY deal_delete ON "deal" FOR DELETE USING (
  ibl_current_workspace_role() = 'admin' AND EXISTS (
    SELECT 1 FROM "destructiveConfirmation" c WHERE c."entityType" = 'DEAL' AND c."entityId" = "deal"."id"
      AND c."entityVersion" = "deal"."version" AND c."requestedByUserId" = ibl_current_user_id()
      AND c."consumedAt" IS NOT NULL AND c."expiresAt" >= NOW()
  )
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT SELECT ON "allocationPolicy", "member", "user", "userProfile", "company", "contact", "deal", "lead", "footballPlayer", "footballAgent", "agency", "club", "contactRouteConsent", "assignment" TO ibl_v2_worker;
    GRANT INSERT, UPDATE ON "assignment" TO ibl_v2_worker;
    GRANT INSERT ON "securityAuditEvent" TO ibl_v2_worker;
  END IF;
END
$$;