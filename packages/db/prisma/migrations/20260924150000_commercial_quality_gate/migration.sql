ALTER TABLE "lead"
    ADD COLUMN "commercialQualityStatus" TEXT,
    ADD COLUMN "commercialQualityReasons" JSONB,
    ADD COLUMN "commercialQualityScore" INTEGER,
    ADD COLUMN "commercialOpportunityCollisionKey" TEXT,
    ADD COLUMN "commercialQualityEvaluatedAt" TIMESTAMP(3),
    ADD COLUMN "commercialLanguage" TEXT,
    ADD COLUMN "commercialLanguageConfidence" TEXT,
    ADD COLUMN "commercialLanguageEvidence" JSONB;

CREATE INDEX "lead_commercialQualityStatus_idx" ON "lead"("commercialQualityStatus");
CREATE INDEX "lead_commercialOpportunityCollisionKey_idx" ON "lead"("commercialOpportunityCollisionKey");
CREATE INDEX "lead_companyId_commercialOpportunityCollisionKey_idx" ON "lead"("companyId", "commercialOpportunityCollisionKey");
