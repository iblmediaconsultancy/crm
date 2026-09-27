CREATE TYPE "OrganizationProtectionStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "organizationProtection" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "status" "OrganizationProtectionStatus" NOT NULL DEFAULT 'ACTIVE',
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
  CONSTRAINT "organizationProtection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizationProtection_idempotencyKey_key" ON "organizationProtection"("idempotencyKey");
CREATE UNIQUE INDEX "organizationProtection_companyId_active_key" ON "organizationProtection"("companyId") WHERE "status" = 'ACTIVE';
CREATE INDEX "organizationProtection_companyId_status_idx" ON "organizationProtection"("companyId", "status");

ALTER TABLE "organizationProtection" ADD CONSTRAINT "organizationProtection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organizationProtection" ADD CONSTRAINT "organizationProtection_protectedByUserId_fkey" FOREIGN KEY ("protectedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organizationProtection" ADD CONSTRAINT "organizationProtection_releasedByUserId_fkey" FOREIGN KEY ("releasedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
