ALTER TABLE "contactRoute" ADD COLUMN "linkedinMemberIdentifier" TEXT;

ALTER TABLE "linkedinConversation" ADD COLUMN "linkedinMemberIdentifier" TEXT;

CREATE INDEX "contactRoute_type_linkedinMemberIdentifier_idx" ON "contactRoute"("type", "linkedinMemberIdentifier");

CREATE INDEX "linkedinConversation_linkedinMemberIdentifier_idx" ON "linkedinConversation"("linkedinMemberIdentifier");
