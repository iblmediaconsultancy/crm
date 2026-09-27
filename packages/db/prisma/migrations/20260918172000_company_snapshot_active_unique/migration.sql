DROP INDEX IF EXISTS "companyFinancialSnapshot_currency_periodStart_lifecycleState_key";

CREATE UNIQUE INDEX "companyFinancialSnapshot_currency_periodStart_active_key"
  ON "companyFinancialSnapshot"("currency", "periodStart")
  WHERE "lifecycleState" = 'ACTIVE';
