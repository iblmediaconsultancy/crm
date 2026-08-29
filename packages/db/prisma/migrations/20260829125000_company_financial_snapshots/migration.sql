CREATE TABLE "companyFinancialSnapshot" (
  "id" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL,
  "recurringRevenueBase" DECIMAL(24,4),
  "oneOffRevenueBase" DECIMAL(24,4),
  "revenueBase" DECIMAL(24,4),
  "directClientCostBase" DECIMAL(24,4),
  "commissionBase" DECIMAL(24,4),
  "operatingCostBase" DECIMAL(24,4),
  "estimatedProfitBase" DECIMAL(24,4),
  "margin" DECIMAL(7,4),
  "outstandingBase" DECIMAL(24,4),
  "newMrrBase" DECIMAL(24,4),
  "lostMrrBase" DECIMAL(24,4),
  "activeClients" INTEGER NOT NULL DEFAULT 0,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "companyFinancialSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companyFinancialSnapshot_currency_periodStart_key" ON "companyFinancialSnapshot"("currency", "periodStart");
CREATE INDEX "companyFinancialSnapshot_periodStart_idx" ON "companyFinancialSnapshot"("periodStart");

ALTER TABLE "companyFinancialSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companyFinancialSnapshot" FORCE ROW LEVEL SECURITY;

CREATE POLICY company_financial_snapshot_access ON "companyFinancialSnapshot" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "companyFinancialSnapshot" TO ibl_v2_app;
  END IF;
END
$$;
