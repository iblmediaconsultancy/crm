CREATE TYPE "FollowUpExecutionCohortStatus" AS ENUM ('BUILDING', 'READY', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "FollowUpExecutionCohortMemberStatus" AS ENUM ('PENDING', 'QUEUED', 'BLOCKED');

ALTER TABLE "outreachAuthorization" ADD COLUMN "followUpCohortId" TEXT;

CREATE TABLE "followUpExecutionCohort" (
  "id" TEXT NOT NULL,
  "state" "FollowUpExecutionCohortStatus" NOT NULL DEFAULT 'BUILDING',
  "createdById" TEXT NOT NULL,
  "sourceContext" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "followUpExecutionCohort_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "followUpExecutionCohortMember" (
  "id" TEXT NOT NULL,
  "cohortId" TEXT NOT NULL,
  "followUpStepId" TEXT NOT NULL,
  "canonicalDueAt" TIMESTAMP(3) NOT NULL,
  "status" "FollowUpExecutionCohortMemberStatus" NOT NULL DEFAULT 'PENDING',
  "blockReason" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "followUpExecutionCohortMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outreachAuthorization_followUpCohortId_key" ON "outreachAuthorization"("followUpCohortId");
CREATE INDEX "followUpExecutionCohort_state_createdAt_idx" ON "followUpExecutionCohort"("state", "createdAt");
CREATE UNIQUE INDEX "followUpExecutionCohortMember_cohortId_followUpStepId_key" ON "followUpExecutionCohortMember"("cohortId", "followUpStepId");
CREATE INDEX "followUpExecutionCohortMember_followUpStepId_status_idx" ON "followUpExecutionCohortMember"("followUpStepId", "status");
CREATE INDEX "followUpExecutionCohortMember_cohortId_status_canonicalDueAt_idx" ON "followUpExecutionCohortMember"("cohortId", "status", "canonicalDueAt");

ALTER TABLE "followUpExecutionCohort" ADD CONSTRAINT "followUpExecutionCohort_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "followUpExecutionCohortMember" ADD CONSTRAINT "followUpExecutionCohortMember_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "followUpExecutionCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "followUpExecutionCohortMember" ADD CONSTRAINT "followUpExecutionCohortMember_followUpStepId_fkey" FOREIGN KEY ("followUpStepId") REFERENCES "followUpStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outreachAuthorization" ADD CONSTRAINT "outreachAuthorization_followUpCohortId_fkey" FOREIGN KEY ("followUpCohortId") REFERENCES "followUpExecutionCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "followUpExecutionCohort" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followUpExecutionCohort" FORCE ROW LEVEL SECURITY;
CREATE POLICY follow_up_execution_cohort_read ON "followUpExecutionCohort" FOR SELECT
  USING (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'));
CREATE POLICY follow_up_execution_cohort_manage ON "followUpExecutionCohort" FOR ALL
  USING (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'))
  WITH CHECK (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'));

ALTER TABLE "followUpExecutionCohortMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followUpExecutionCohortMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY follow_up_execution_cohort_member_read ON "followUpExecutionCohortMember" FOR SELECT
  USING (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'));
CREATE POLICY follow_up_execution_cohort_member_manage ON "followUpExecutionCohortMember" FOR ALL
  USING (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'))
  WITH CHECK (ibl_current_workspace_role() IN ('admin', 'team') OR ibl_current_principal_kind() IN ('worker', 'service'));

CREATE OR REPLACE FUNCTION ibl_guard_follow_up_execution_cohort() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'BUILDING' THEN
      RAISE EXCEPTION 'follow-up execution cohorts must start in BUILDING state' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'follow-up execution cohorts are immutable audit records' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."createdById" <> OLD."createdById" OR NEW."sourceContext" <> OLD."sourceContext" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'follow-up execution cohort identity and preflight context are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."state" <> OLD."state" AND NOT (
    (OLD."state" = 'BUILDING' AND NEW."state" IN ('READY', 'CANCELLED')) OR
    (OLD."state" = 'READY' AND NEW."state" IN ('ACTIVE', 'CANCELLED')) OR
    (OLD."state" = 'ACTIVE' AND NEW."state" IN ('COMPLETED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid follow-up execution cohort state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."state" = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM "outreachAuthorization" a
    WHERE a."followUpCohortId" = NEW."id"
      AND a."scope" = 'STANDARD_COLD_OUTREACH'
      AND a."status" = 'ACTIVE'
      AND (a."expiresAt" IS NULL OR a."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
  ) THEN
    RAISE EXCEPTION 'an active follow-up cohort requires a valid bound authorization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER follow_up_execution_cohort_guard
BEFORE INSERT OR UPDATE OR DELETE ON "followUpExecutionCohort"
FOR EACH ROW EXECUTE FUNCTION ibl_guard_follow_up_execution_cohort();

CREATE OR REPLACE FUNCTION ibl_guard_follow_up_execution_cohort_member() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  cohort_state "FollowUpExecutionCohortStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'follow-up execution cohort membership is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "state" INTO cohort_state FROM "followUpExecutionCohort" WHERE "id" = NEW."cohortId";
    IF cohort_state <> 'BUILDING' THEN
      RAISE EXCEPTION 'membership can only be added while a cohort is building' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."cohortId" <> OLD."cohortId" OR NEW."followUpStepId" <> OLD."followUpStepId" OR NEW."canonicalDueAt" <> OLD."canonicalDueAt" OR NEW."evaluatedAt" <> OLD."evaluatedAt" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'follow-up execution cohort membership identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('QUEUED', 'BLOCKED')) OR
    (OLD."status" = 'QUEUED' AND NEW."status" = 'BLOCKED')
  ) THEN
    RAISE EXCEPTION 'follow-up execution cohort member outcome is terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER follow_up_execution_cohort_member_guard
BEFORE INSERT OR UPDATE OR DELETE ON "followUpExecutionCohortMember"
FOR EACH ROW EXECUTE FUNCTION ibl_guard_follow_up_execution_cohort_member();

CREATE OR REPLACE FUNCTION ibl_guard_outreach_authorization_follow_up_cohort() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."followUpCohortId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "followUpExecutionCohort" c
    JOIN "followUpExecutionCohortMember" m ON m."cohortId" = c."id"
    WHERE c."id" = NEW."followUpCohortId" AND c."state" = 'READY'
  ) THEN
    RAISE EXCEPTION 'authorization must bind to a prepared cohort with members' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW."followUpCohortId" IS DISTINCT FROM OLD."followUpCohortId" THEN
    RAISE EXCEPTION 'an authorization cannot be rebound to a different follow-up cohort' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER outreach_authorization_follow_up_cohort_guard
BEFORE INSERT OR UPDATE ON "outreachAuthorization"
FOR EACH ROW EXECUTE FUNCTION ibl_guard_outreach_authorization_follow_up_cohort();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_api') THEN
    GRANT SELECT, INSERT, UPDATE ON "followUpExecutionCohort", "followUpExecutionCohortMember" TO ibl_v2_api;
    GRANT SELECT, INSERT, UPDATE ON "outreachAuthorization" TO ibl_v2_api;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_worker') THEN
    GRANT SELECT ON "followUpExecutionCohort" TO ibl_v2_worker;
    GRANT SELECT, UPDATE ON "followUpExecutionCohortMember" TO ibl_v2_worker;
    GRANT SELECT ON "outreachAuthorization" TO ibl_v2_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_agent') THEN
    GRANT SELECT ON "followUpExecutionCohort", "followUpExecutionCohortMember" TO ibl_v2_agent;
  END IF;
END
$$;
