ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncLeaseOwner" TEXT;
ALTER TABLE "outboundDelivery" ADD COLUMN "sentSyncLeasedUntil" TIMESTAMP(3);
CREATE INDEX "outboundDelivery_sentSyncLease_idx" ON "outboundDelivery"("sentSyncStatus", "sentSyncRetryAt", "sentSyncLeasedUntil");
