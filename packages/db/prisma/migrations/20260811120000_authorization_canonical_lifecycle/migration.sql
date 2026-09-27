CREATE TYPE "CanonicalLifecycleState" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "company"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByUserId" TEXT,
  ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "contact"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByUserId" TEXT,
  ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "deal"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByUserId" TEXT,
  ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "activity"
  ADD COLUMN "lifecycleState" "CanonicalLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedByUserId" TEXT,
  ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "company_lifecycleState_name_idx" ON "company"("lifecycleState", "name");
CREATE INDEX "contact_lifecycleState_firstName_idx" ON "contact"("lifecycleState", "firstName");
CREATE INDEX "deal_lifecycleState_name_idx" ON "deal"("lifecycleState", "name");

CREATE TABLE "canonicalAlias" (
  "id" TEXT NOT NULL,
  "entityType" "DomainEntityType" NOT NULL,
  "aliasEntityId" TEXT NOT NULL,
  "survivorEntityId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canonicalAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "canonicalAlias_entityType_aliasEntityId_key" ON "canonicalAlias"("entityType", "aliasEntityId");
CREATE INDEX "canonicalAlias_entityType_survivorEntityId_idx" ON "canonicalAlias"("entityType", "survivorEntityId");

CREATE TABLE "canonicalTombstone" (
  "id" TEXT NOT NULL,
  "entityType" "DomainEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "survivorEntityId" TEXT,
  "kind" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canonicalTombstone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "canonicalTombstone_entityType_entityId_key" ON "canonicalTombstone"("entityType", "entityId");
CREATE INDEX "canonicalTombstone_entityType_survivorEntityId_idx" ON "canonicalTombstone"("entityType", "survivorEntityId");

CREATE TABLE "destructiveConfirmation" (
  "id" TEXT NOT NULL,
  "entityType" "DomainEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityVersion" INTEGER NOT NULL,
  "dependencyDigest" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "destructiveConfirmation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "destructiveConfirmation_requestedByUserId_expiresAt_idx"
  ON "destructiveConfirmation"("requestedByUserId", "expiresAt");

ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company" FORCE ROW LEVEL SECURITY;
ALTER TABLE "contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact" FORCE ROW LEVEL SECURITY;
ALTER TABLE "deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "canonicalAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canonicalAlias" FORCE ROW LEVEL SECURITY;
ALTER TABLE "canonicalTombstone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canonicalTombstone" FORCE ROW LEVEL SECURITY;
ALTER TABLE "destructiveConfirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "destructiveConfirmation" FORCE ROW LEVEL SECURITY;

CREATE POLICY company_read ON "company" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY company_insert ON "company" FOR INSERT
  WITH CHECK (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id());
CREATE POLICY company_update ON "company" FOR UPDATE
  USING (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id() OR EXISTS (
    SELECT 1 FROM "assignment" a WHERE a."entityType" = 'COMPANY' AND a."entityId" = "company"."id" AND a."assigneeUserId" = ibl_current_user_id() AND a."revokedAt" IS NULL
  ))
  WITH CHECK (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id() OR EXISTS (
    SELECT 1 FROM "assignment" a WHERE a."entityType" = 'COMPANY' AND a."entityId" = "company"."id" AND a."assigneeUserId" = ibl_current_user_id() AND a."revokedAt" IS NULL
  ));
CREATE POLICY company_delete ON "company" FOR DELETE
  USING (
    ibl_current_workspace_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM "destructiveConfirmation" confirmation
      WHERE confirmation."entityType" = 'COMPANY'
        AND confirmation."entityId" = "company"."id"
        AND confirmation."entityVersion" = "company"."version"
        AND confirmation."requestedByUserId" = ibl_current_user_id()
        AND confirmation."consumedAt" IS NOT NULL
        AND confirmation."expiresAt" >= NOW()
    )
  );

CREATE POLICY contact_read ON "contact" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY contact_insert ON "contact" FOR INSERT
  WITH CHECK (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id());
CREATE POLICY contact_update ON "contact" FOR UPDATE
  USING (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id() OR EXISTS (
    SELECT 1 FROM "assignment" a WHERE a."entityType" = 'CONTACT' AND a."entityId" = "contact"."id" AND a."assigneeUserId" = ibl_current_user_id() AND a."revokedAt" IS NULL
  ))
  WITH CHECK (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id() OR EXISTS (
    SELECT 1 FROM "assignment" a WHERE a."entityType" = 'CONTACT' AND a."entityId" = "contact"."id" AND a."assigneeUserId" = ibl_current_user_id() AND a."revokedAt" IS NULL
  ));
CREATE POLICY contact_delete ON "contact" FOR DELETE
  USING (
    ibl_current_workspace_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM "destructiveConfirmation" confirmation
      WHERE confirmation."entityType" = 'CONTACT'
        AND confirmation."entityId" = "contact"."id"
        AND confirmation."entityVersion" = "contact"."version"
        AND confirmation."requestedByUserId" = ibl_current_user_id()
        AND confirmation."consumedAt" IS NOT NULL
        AND confirmation."expiresAt" >= NOW()
    )
  );

CREATE POLICY deal_read ON "deal" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY deal_insert ON "deal" FOR INSERT
  WITH CHECK (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id());
CREATE POLICY deal_update ON "deal" FOR UPDATE
  USING (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id() OR EXISTS (
    SELECT 1 FROM "assignment" a WHERE a."entityType" = 'DEAL' AND a."entityId" = "deal"."id" AND a."assigneeUserId" = ibl_current_user_id() AND a."revokedAt" IS NULL
  ))
  WITH CHECK (ibl_can_manage_crm() OR "ownerId" = ibl_current_user_id() OR EXISTS (
    SELECT 1 FROM "assignment" a WHERE a."entityType" = 'DEAL' AND a."entityId" = "deal"."id" AND a."assigneeUserId" = ibl_current_user_id() AND a."revokedAt" IS NULL
  ));
CREATE POLICY deal_delete ON "deal" FOR DELETE
  USING (
    ibl_current_workspace_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM "destructiveConfirmation" confirmation
      WHERE confirmation."entityType" = 'DEAL'
        AND confirmation."entityId" = "deal"."id"
        AND confirmation."entityVersion" = "deal"."version"
        AND confirmation."requestedByUserId" = ibl_current_user_id()
        AND confirmation."consumedAt" IS NOT NULL
        AND confirmation."expiresAt" >= NOW()
    )
  );

CREATE POLICY activity_read ON "activity" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY activity_insert ON "activity" FOR INSERT
  WITH CHECK ("createdById" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY activity_update ON "activity" FOR UPDATE
  USING ("createdById" = ibl_current_user_id() OR ibl_can_manage_crm())
  WITH CHECK ("createdById" = ibl_current_user_id() OR ibl_can_manage_crm());
CREATE POLICY activity_delete ON "activity" FOR DELETE
  USING (ibl_current_workspace_role() = 'admin');

CREATE POLICY canonical_alias_read ON "canonicalAlias" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY canonical_alias_manage ON "canonicalAlias" FOR ALL
  USING (ibl_can_manage_crm()) WITH CHECK (ibl_can_manage_crm());
CREATE POLICY canonical_tombstone_read ON "canonicalTombstone" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY canonical_tombstone_manage ON "canonicalTombstone" FOR ALL
  USING (ibl_can_manage_crm()) WITH CHECK (ibl_can_manage_crm());
CREATE POLICY destructive_confirmation_admin ON "destructiveConfirmation" FOR ALL
  USING (ibl_current_workspace_role() = 'admin' AND "requestedByUserId" = ibl_current_user_id())
  WITH CHECK (ibl_current_workspace_role() = 'admin' AND "requestedByUserId" = ibl_current_user_id());

CREATE TRIGGER canonical_alias_immutable
  BEFORE UPDATE OR DELETE ON "canonicalAlias"
  FOR EACH ROW EXECUTE FUNCTION ibl_reject_immutable_change();
CREATE TRIGGER canonical_tombstone_immutable
  BEFORE UPDATE OR DELETE ON "canonicalTombstone"
  FOR EACH ROW EXECUTE FUNCTION ibl_reject_immutable_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "company", "contact", "deal", "activity", "canonicalAlias",
      "canonicalTombstone", "destructiveConfirmation"
    TO ibl_v2_app;
  END IF;
END
$$;