-- Durable workflow records retain referential integrity. Canonical/history parents
-- are restrictive; nullable actor references survive member deactivation/removal.
ALTER TABLE "systemEmailJob" ADD CONSTRAINT "systemEmailJob_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contactRouteConsent" ADD CONSTRAINT "contactRouteConsent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "contactRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contactRouteConsent" ADD CONSTRAINT "contactRouteConsent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contactRouteConsent" ADD CONSTRAINT "contactRouteConsent_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "followUpPlan" ADD CONSTRAINT "followUpPlan_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "followUpPlan" ADD CONSTRAINT "followUpPlan_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "contactRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "followUpPlan" ADD CONSTRAINT "followUpPlan_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "followUpPlan" ADD CONSTRAINT "followUpPlan_sourceDraftId_fkey" FOREIGN KEY ("sourceDraftId") REFERENCES "draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "followUpStep" ADD CONSTRAINT "followUpStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "followUpPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "followUpStep" ADD CONSTRAINT "followUpStep_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outreachEvent" ADD CONSTRAINT "outreachEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "outboundDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocationPolicy" ADD CONSTRAINT "allocationPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocationRequest" ADD CONSTRAINT "allocationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "allocationRequest" ADD CONSTRAINT "allocationRequest_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messageAttachment" ADD CONSTRAINT "messageAttachment_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messageAttachment" ADD CONSTRAINT "messageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "emailMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachmentScanJob" ADD CONSTRAINT "attachmentScanJob_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "messageAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mimeIngestionError" ADD CONSTRAINT "mimeIngestionError_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "providerEvidence" ADD CONSTRAINT "providerEvidence_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "systemEmailJob_actorUserId_idx" ON "systemEmailJob"("actorUserId");
CREATE INDEX "contactRouteConsent_changedByUserId_idx" ON "contactRouteConsent"("changedByUserId");
CREATE INDEX "followUpPlan_routeId_idx" ON "followUpPlan"("routeId");
CREATE INDEX "followUpPlan_sourceDraftId_idx" ON "followUpPlan"("sourceDraftId");
CREATE INDEX "followUpStep_draftId_idx" ON "followUpStep"("draftId");
CREATE INDEX "allocationPolicy_createdByUserId_idx" ON "allocationPolicy"("createdByUserId");
CREATE INDEX "allocationRequest_requestedByUserId_idx" ON "allocationRequest"("requestedByUserId");
CREATE INDEX "allocationRequest_assigneeUserId_idx" ON "allocationRequest"("assigneeUserId");
CREATE INDEX "messageAttachment_messageId_idx" ON "messageAttachment"("messageId");
CREATE INDEX "providerEvidence_operatorUserId_idx" ON "providerEvidence"("operatorUserId");