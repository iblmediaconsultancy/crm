CREATE TYPE "ProspectBacklogMailboxType" AS ENUM ('PERSONAL', 'ROLE', 'GENERAL', 'UNKNOWN');
CREATE TYPE "ProspectBacklogRouteUsage" AS ENUM ('CONTACT_ONCE', 'REUSABLE');
CREATE TYPE "ProspectBacklogHookType" AS ENUM ('CURRENT_EVENT', 'MEDIA_GAP', 'FIRST_TEAM_BREAKTHROUGH', 'INTERNATIONAL_VISIBILITY', 'EMERGING_TALENT', 'NEW_SEASON_ROLE_MARKET', 'ROSTER_MEDIA_GAP', 'EXISTING_RELATIONSHIP', 'OTHER_SPECIFIC_OPPORTUNITY');

ALTER TABLE "prospectBacklogRoute"
ADD COLUMN "mailboxType" "ProspectBacklogMailboxType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "mailboxTypeEvidence" TEXT,
ADD COLUMN "routeUsage" "ProspectBacklogRouteUsage" NOT NULL DEFAULT 'CONTACT_ONCE';

ALTER TABLE "prospectBacklogPilotItem"
ADD COLUMN "mailboxType" "ProspectBacklogMailboxType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "mailboxTypeEvidence" TEXT,
ADD COLUMN "routeUsage" "ProspectBacklogRouteUsage" NOT NULL DEFAULT 'CONTACT_ONCE',
ADD COLUMN "hookType" "ProspectBacklogHookType" NOT NULL DEFAULT 'CURRENT_EVENT';

UPDATE "prospectBacklogRoute"
SET "routeUsage" = CASE
  WHEN "contactOnce" = true THEN 'CONTACT_ONCE'::"ProspectBacklogRouteUsage"
  ELSE 'REUSABLE'::"ProspectBacklogRouteUsage"
END;

DROP INDEX "prospectBacklogRoute_batchId_isShared_idx";
ALTER TABLE "prospectBacklogRoute"
DROP COLUMN "isShared",
DROP COLUMN "contactOnce";

CREATE INDEX "prospectBacklogRoute_batchId_mailboxType_idx" ON "prospectBacklogRoute"("batchId", "mailboxType");
CREATE INDEX "prospectBacklogRoute_batchId_routeUsage_idx" ON "prospectBacklogRoute"("batchId", "routeUsage");
