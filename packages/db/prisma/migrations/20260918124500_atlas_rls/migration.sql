ALTER TABLE "leadStageHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leadStageHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_stage_history_read ON "leadStageHistory" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL OR current_setting('ibl.principal_kind', true) IN ('worker', 'service'));
CREATE POLICY lead_stage_history_write ON "leadStageHistory" FOR INSERT
  WITH CHECK ("actorUserId" = ibl_current_user_id() OR ibl_can_manage_crm() OR current_setting('ibl.principal_kind', true) IN ('worker', 'service'));

ALTER TABLE "outreachQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreachQuota" FORCE ROW LEVEL SECURITY;
CREATE POLICY outreach_quota_access ON "outreachQuota" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL OR current_setting('ibl.principal_kind', true) IN ('worker', 'service'))
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL OR current_setting('ibl.principal_kind', true) IN ('worker', 'service'));
