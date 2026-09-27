DROP INDEX IF EXISTS "company_domain_key";
DROP INDEX IF EXISTS "contact_email_key";
CREATE INDEX IF NOT EXISTS "company_domain_idx" ON "company"("domain");
CREATE INDEX IF NOT EXISTS "contact_email_idx" ON "contact"("email");

ALTER TABLE "duplicateCandidate"
  ADD COLUMN "scoreComponents" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "detectorVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "leftVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rightVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "duplicateCandidate"
  ALTER COLUMN "scoreComponents" DROP DEFAULT,
  ALTER COLUMN "detectorVersion" DROP DEFAULT,
  ALTER COLUMN "leftVersion" DROP DEFAULT,
  ALTER COLUMN "rightVersion" DROP DEFAULT;
ALTER TABLE "mergeDecision" ADD COLUMN "fieldChoices" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "mergeDecision" ALTER COLUMN "fieldChoices" DROP DEFAULT;