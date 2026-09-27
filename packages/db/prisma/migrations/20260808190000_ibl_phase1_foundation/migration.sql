CREATE TYPE "UserProfileStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "MailboxProvider" AS ENUM ('MIAB');
CREATE TYPE "MailboxStatus" AS ENUM ('DISABLED', 'UNVERIFIED', 'VERIFIED', 'ERROR');
CREATE TYPE "MailboxGrantPermission" AS ENUM ('READ');
CREATE TYPE "ProviderCapabilityKey" AS ENUM ('MIAB_IMAP', 'RESEND_OUTBOUND');
CREATE TYPE "ProviderCapabilityStatus" AS ENUM ('DISABLED', 'UNVERIFIED', 'VERIFIED');

UPDATE "member" SET "role" = CASE WHEN "role" IN ('owner', 'admin') THEN 'admin' ELSE 'contributor' END;
ALTER TABLE "member" ADD CONSTRAINT "member_role_ibl_check" CHECK ("role" IN ('admin', 'team', 'contributor'));

CREATE TABLE "userProfile" (
  "userId" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "status" "UserProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "preferredLanguage" TEXT NOT NULL DEFAULT 'English',
  "locale" TEXT NOT NULL DEFAULT 'en',
  "timeZone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  "workingPreferences" JSONB NOT NULL DEFAULT '{}',
  "activatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "suspendedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "userProfile" ("userId") SELECT "id" FROM "user" ON CONFLICT DO NOTHING;

CREATE TABLE "mailbox" (
  "id" TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "provider" "MailboxProvider" NOT NULL DEFAULT 'MIAB',
  "address" TEXT NOT NULL,
  "normalizedAddress" TEXT NOT NULL UNIQUE,
  "displayName" TEXT,
  "signature" TEXT,
  "status" "MailboxStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mailbox_ownerUserId_idx" ON "mailbox"("ownerUserId");
CREATE INDEX "mailbox_status_idx" ON "mailbox"("status");

CREATE TABLE "mailboxGrant" (
  "id" TEXT PRIMARY KEY,
  "mailboxId" TEXT NOT NULL REFERENCES "mailbox"("id") ON DELETE CASCADE,
  "granteeUserId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "grantedByUserId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "permission" "MailboxGrantPermission" NOT NULL DEFAULT 'READ',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "mailboxGrant_mailboxId_idx" ON "mailboxGrant"("mailboxId");
CREATE INDEX "mailboxGrant_granteeUserId_idx" ON "mailboxGrant"("granteeUserId");
CREATE INDEX "mailboxGrant_mailboxId_granteeUserId_permission_idx" ON "mailboxGrant"("mailboxId", "granteeUserId", "permission");
CREATE UNIQUE INDEX "mailboxGrant_one_active_read" ON "mailboxGrant"("mailboxId", "granteeUserId", "permission") WHERE "revokedAt" IS NULL;

CREATE TABLE "providerCapability" (
  "key" "ProviderCapabilityKey" PRIMARY KEY,
  "status" "ProviderCapabilityStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "evidenceReference" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "providerCapability" ("key", "status") VALUES ('MIAB_IMAP', 'UNVERIFIED'), ('RESEND_OUTBOUND', 'UNVERIFIED') ON CONFLICT DO NOTHING;

CREATE TABLE "securityAuditEvent" (
  "id" TEXT PRIMARY KEY,
  "actorUserId" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "outcome" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "securityAuditEvent_actorUserId_createdAt_idx" ON "securityAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "securityAuditEvent_action_createdAt_idx" ON "securityAuditEvent"("action", "createdAt");

INSERT INTO "mailbox" ("id", "ownerUserId", "address", "normalizedAddress", "displayName")
SELECT 'phase1-' || md5(u."id"), u."id", u."email", lower(trim(u."email")), u."name"
FROM "user" u
WHERE EXISTS (SELECT 1 FROM "mailboxSync" s WHERE s."userId" = u."id")
   OR EXISTS (SELECT 1 FROM "emailMessage" e WHERE e."syncedByUserId" = u."id")
ON CONFLICT ("normalizedAddress") DO NOTHING;

ALTER TABLE "mailboxSync" ADD COLUMN "mailboxId" TEXT;
UPDATE "mailboxSync" s SET "mailboxId" = m."id" FROM "mailbox" m WHERE m."ownerUserId" = s."userId";
ALTER TABLE "mailboxSync" ALTER COLUMN "mailboxId" SET NOT NULL;
ALTER TABLE "mailboxSync" ADD CONSTRAINT "mailboxSync_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "mailboxSync_mailboxId_source_key" ON "mailboxSync"("mailboxId", "source");
CREATE INDEX "mailboxSync_mailboxId_idx" ON "mailboxSync"("mailboxId");

ALTER TABLE "emailThread" ADD COLUMN "mailboxId" TEXT;
ALTER TABLE "emailMessage" ADD COLUMN "mailboxId" TEXT;
UPDATE "emailMessage" e SET "mailboxId" = m."id" FROM "mailbox" m WHERE m."ownerUserId" = e."syncedByUserId";
UPDATE "emailThread" t SET "mailboxId" = s."mailboxId"
FROM (SELECT "threadId", min("mailboxId") AS "mailboxId" FROM "emailMessage" WHERE "mailboxId" IS NOT NULL GROUP BY "threadId") s
WHERE s."threadId" = t."id";
UPDATE "emailMessage" e SET "mailboxId" = t."mailboxId" FROM "emailThread" t WHERE e."threadId" = t."id" AND e."mailboxId" IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "emailThread" WHERE "mailboxId" IS NULL) OR EXISTS (SELECT 1 FROM "emailMessage" WHERE "mailboxId" IS NULL) THEN
    RAISE EXCEPTION 'Existing email data cannot be assigned to exactly one mailbox';
  END IF;
END $$;
ALTER TABLE "emailThread" ALTER COLUMN "mailboxId" SET NOT NULL;
ALTER TABLE "emailMessage" ALTER COLUMN "mailboxId" SET NOT NULL;
DROP INDEX IF EXISTS "emailThread_rootMessageId_key";
DROP INDEX IF EXISTS "emailMessage_rfcMessageId_key";
ALTER TABLE "emailMessage" DROP CONSTRAINT IF EXISTS "emailMessage_threadId_fkey";
ALTER TABLE "emailThread" ADD CONSTRAINT "emailThread_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;
ALTER TABLE "emailMessage" ADD CONSTRAINT "emailMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "emailThread_mailboxId_rootMessageId_key" ON "emailThread"("mailboxId", "rootMessageId");
CREATE UNIQUE INDEX "emailThread_id_mailboxId_key" ON "emailThread"("id", "mailboxId");
ALTER TABLE "emailMessage" ADD CONSTRAINT "emailMessage_threadId_mailboxId_fkey" FOREIGN KEY ("threadId", "mailboxId") REFERENCES "emailThread"("id", "mailboxId") ON DELETE CASCADE;
CREATE INDEX "emailMessage_mailboxId_sentAt_idx" ON "emailMessage"("mailboxId", "sentAt");
CREATE UNIQUE INDEX "emailMessage_mailboxId_rfcMessageId_key" ON "emailMessage"("mailboxId", "rfcMessageId");

CREATE FUNCTION ibl_current_user_id() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('ibl.user_id', true), '') $$;
CREATE FUNCTION ibl_current_mailbox_id() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('ibl.mailbox_id', true), '') $$;
CREATE FUNCTION ibl_current_principal_kind() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('ibl.principal_kind', true), '') $$;
CREATE FUNCTION ibl_can_read_mailbox(target_mailbox_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "mailbox" m
    WHERE m."id" = target_mailbox_id AND (
      m."ownerUserId" = ibl_current_user_id()
      OR EXISTS (
        SELECT 1 FROM "mailboxGrant" g
        WHERE g."mailboxId" = m."id" AND g."granteeUserId" = ibl_current_user_id()
          AND g."permission" = 'READ' AND g."revokedAt" IS NULL
      )
      OR (ibl_current_principal_kind() = 'worker' AND ibl_current_mailbox_id() = m."id")
    )
  )
$$;

ALTER TABLE "mailbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mailbox" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mailboxGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mailboxGrant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "emailThread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emailThread" FORCE ROW LEVEL SECURITY;
ALTER TABLE "emailMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emailMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY mailbox_read ON "mailbox" FOR SELECT USING (ibl_can_read_mailbox("id"));
CREATE POLICY mailbox_insert ON "mailbox" FOR INSERT WITH CHECK ("ownerUserId" = ibl_current_user_id());
CREATE POLICY mailbox_update ON "mailbox" FOR UPDATE USING ("ownerUserId" = ibl_current_user_id()) WITH CHECK ("ownerUserId" = ibl_current_user_id());
CREATE POLICY mailbox_delete ON "mailbox" FOR DELETE USING ("ownerUserId" = ibl_current_user_id());
CREATE POLICY mailbox_grant_read ON "mailboxGrant" FOR SELECT USING (ibl_can_read_mailbox("mailboxId"));
CREATE POLICY mailbox_grant_write ON "mailboxGrant" FOR ALL USING (EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id())) WITH CHECK (EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id()));
CREATE POLICY email_thread_read ON "emailThread" FOR SELECT USING (ibl_can_read_mailbox("mailboxId"));
CREATE POLICY email_thread_owner_write ON "emailThread" FOR ALL USING (EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id())) WITH CHECK (EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id()));
CREATE POLICY email_message_read ON "emailMessage" FOR SELECT USING (ibl_can_read_mailbox("mailboxId"));
CREATE POLICY email_message_owner_write ON "emailMessage" FOR ALL USING (EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id())) WITH CHECK (EXISTS (SELECT 1 FROM "mailbox" m WHERE m."id" = "mailboxId" AND m."ownerUserId" = ibl_current_user_id()));

CREATE FUNCTION ibl_assert_active_admin() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  populated BOOLEAN;
  active_admins INTEGER;
BEGIN
  PERFORM 1 FROM "organization" WHERE "id" = 'workspace' FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM "member" WHERE "organizationId" = 'workspace') INTO populated;
  IF NOT populated THEN RETURN NULL; END IF;
  SELECT count(*) INTO active_admins
  FROM "member" m JOIN "userProfile" p ON p."userId" = m."userId"
  WHERE m."organizationId" = 'workspace' AND m."role" = 'admin' AND p."status" = 'ACTIVE';
  IF active_admins = 0 THEN
    RAISE EXCEPTION 'IBL workspace must retain at least one active Admin' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER member_active_admin_guard AFTER INSERT OR UPDATE OR DELETE ON "member" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_active_admin();
CREATE CONSTRAINT TRIGGER profile_active_admin_guard AFTER INSERT OR UPDATE OR DELETE ON "userProfile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ibl_assert_active_admin();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT USAGE ON SCHEMA public TO ibl_v2_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ibl_v2_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ibl_v2_app;
    REVOKE ALL ON FUNCTION ibl_can_read_mailbox(TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ibl_can_read_mailbox(TEXT) TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_current_user_id() TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_current_mailbox_id() TO ibl_v2_app;
    GRANT EXECUTE ON FUNCTION ibl_current_principal_kind() TO ibl_v2_app;
  END IF;
END
$$;
