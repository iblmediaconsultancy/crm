CREATE TYPE "InboundIntent" AS ENUM ('AUTO_REPLY', 'HUMAN_POSITIVE', 'HUMAN_NEUTRAL', 'HUMAN_NEGATIVE', 'REFERRAL_OR_ROUTING', 'SECURITY_REVIEW');

ALTER TABLE "emailMessage" ADD COLUMN "inboundIntent" "InboundIntent";
ALTER TABLE "emailMessage" ADD COLUMN "inboundIntentReason" TEXT;
ALTER TABLE "emailMessage" ADD COLUMN "inboundSecuritySignals" JSONB;

ALTER TABLE "outboundDelivery" ADD COLUMN "replyIntent" "InboundIntent";
ALTER TABLE "outboundDelivery" ADD COLUMN "replyIntentAt" TIMESTAMP(3);

CREATE INDEX "outboundDelivery_replyIntent_replyIntentAt_idx" ON "outboundDelivery"("replyIntent", "replyIntentAt");
