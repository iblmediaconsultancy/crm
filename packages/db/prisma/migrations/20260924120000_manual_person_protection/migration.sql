CREATE TYPE "PersonProtectionStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "personProtection" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "PersonProtectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "protectedByUserId" TEXT NOT NULL,
    "protectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByUserId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personProtection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personProtection_idempotencyKey_key" ON "personProtection"("idempotencyKey");
CREATE UNIQUE INDEX "personProtection_contactId_active_key" ON "personProtection"("contactId") WHERE "status" = 'ACTIVE';
CREATE INDEX "personProtection_contactId_status_idx" ON "personProtection"("contactId", "status");

ALTER TABLE "personProtection" ADD CONSTRAINT "personProtection_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personProtection" ADD CONSTRAINT "personProtection_protectedByUserId_fkey" FOREIGN KEY ("protectedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personProtection" ADD CONSTRAINT "personProtection_releasedByUserId_fkey" FOREIGN KEY ("releasedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
