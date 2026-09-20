ALTER TABLE "prospectBacklogPilotItem"
ADD COLUMN "routeVisibility" "ContactRouteVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN "routeConfidence" TEXT NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "researchConfidence" TEXT NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "credibilityAngle" TEXT NOT NULL DEFAULT '',
ADD COLUMN "ctaApproach" TEXT NOT NULL DEFAULT '',
ADD COLUMN "ctaWhy" TEXT NOT NULL DEFAULT '',
ADD COLUMN "followUpApproach" TEXT NOT NULL DEFAULT '',
ADD COLUMN "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL';
