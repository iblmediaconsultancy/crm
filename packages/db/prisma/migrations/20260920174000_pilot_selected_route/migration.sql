ALTER TABLE "prospectBacklogPilotItem" ADD COLUMN "routeId" TEXT;

CREATE INDEX "prospectBacklogPilotItem_routeId_idx" ON "prospectBacklogPilotItem"("routeId");

ALTER TABLE "prospectBacklogPilotItem" ADD CONSTRAINT "prospectBacklogPilotItem_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "prospectBacklogRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
