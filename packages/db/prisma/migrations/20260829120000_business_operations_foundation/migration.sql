CREATE TYPE "BillingStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_APPLICABLE', 'CURRENT', 'PENDING', 'OVERDUE', 'PAID');
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');
CREATE TYPE "FinancialEventType" AS ENUM ('PROFILE_CREATED', 'PROFILE_UPDATED', 'FEE_CHANGED', 'STATUS_CHANGED', 'PAYMENT_STATUS_CHANGED', 'CHURNED', 'SNAPSHOT_RECORDED');
CREATE TYPE "CompanyGoalType" AS ENUM ('MRR');

ALTER TABLE "deal"
ADD COLUMN "potentialMonthlyRevenue" DECIMAL(14,2),
ADD COLUMN "potentialMonthlyRevenueBase" DECIMAL(24,4),
ADD COLUMN "potentialOneOffRevenue" DECIMAL(14,2),
ADD COLUMN "potentialOneOffRevenueBase" DECIMAL(24,4),
ADD COLUMN "potentialBaseCurrency" TEXT,
ADD COLUMN "potentialFxRate" DECIMAL(20,10),
ADD COLUMN "potentialFxRateAt" TIMESTAMP(3);

CREATE INDEX "deal_potentialMonthlyRevenueBase_idx" ON "deal"("potentialMonthlyRevenueBase");

CREATE TABLE "clientFinancialProfile" (
  "id" TEXT NOT NULL,
  "dealId" TEXT,
  "companyId" TEXT,
  "contactId" TEXT,
  "packageName" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "baseCurrency" TEXT,
  "fxRate" DECIMAL(20,10),
  "fxRateAt" TIMESTAMP(3),
  "contractStartDate" TIMESTAMP(3),
  "contractEndDate" TIMESTAMP(3),
  "billingStatus" "BillingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  "monthlyFee" DECIMAL(14,2),
  "monthlyFeeBase" DECIMAL(24,4),
  "directMonthlyCost" DECIMAL(14,2),
  "directMonthlyCostBase" DECIMAL(24,4),
  "editorMonthlyCost" DECIMAL(14,2),
  "editorMonthlyCostBase" DECIMAL(24,4),
  "otherRecurringCost" DECIMAL(14,2),
  "otherRecurringCostBase" DECIMAL(24,4),
  "onboardingFee" DECIMAL(14,2),
  "onboardingFeeBase" DECIMAL(24,4),
  "oneOffRevenue" DECIMAL(14,2),
  "oneOffRevenueBase" DECIMAL(24,4),
  "additionalCharges" DECIMAL(14,2),
  "additionalChargesBase" DECIMAL(24,4),
  "outstandingAmount" DECIMAL(14,2),
  "outstandingAmountBase" DECIMAL(24,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clientFinancialProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clientFinancialProfile_dealId_key" ON "clientFinancialProfile"("dealId");
CREATE INDEX "clientFinancialProfile_companyId_billingStatus_idx" ON "clientFinancialProfile"("companyId", "billingStatus");
CREATE INDEX "clientFinancialProfile_contactId_billingStatus_idx" ON "clientFinancialProfile"("contactId", "billingStatus");
CREATE INDEX "clientFinancialProfile_billingStatus_contractStartDate_idx" ON "clientFinancialProfile"("billingStatus", "contractStartDate");

CREATE TABLE "clientCommission" (
  "id" TEXT NOT NULL,
  "financialProfileId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "CommissionType" NOT NULL,
  "recurring" BOOLEAN NOT NULL DEFAULT true,
  "percentage" DECIMAL(5,2),
  "fixedAmount" DECIMAL(14,2),
  "fixedAmountBase" DECIMAL(24,4),
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clientCommission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clientCommission_financialProfileId_active_idx" ON "clientCommission"("financialProfileId", "active");
CREATE INDEX "clientCommission_userId_active_idx" ON "clientCommission"("userId", "active");

CREATE TABLE "financialSnapshot" (
  "id" TEXT NOT NULL,
  "financialProfileId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL,
  "recurringRevenueBase" DECIMAL(24,4),
  "oneOffRevenueBase" DECIMAL(24,4),
  "directCostBase" DECIMAL(24,4),
  "commissionBase" DECIMAL(24,4),
  "operatingCostBase" DECIMAL(24,4),
  "estimatedProfitBase" DECIMAL(24,4),
  "margin" DECIMAL(7,4),
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financialSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financialSnapshot_financialProfileId_periodStart_key" ON "financialSnapshot"("financialProfileId", "periodStart");
CREATE INDEX "financialSnapshot_periodStart_idx" ON "financialSnapshot"("periodStart");

CREATE TABLE "financialEvent" (
  "id" TEXT NOT NULL,
  "financialProfileId" TEXT NOT NULL,
  "type" "FinancialEventType" NOT NULL,
  "actorUserId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB,
  CONSTRAINT "financialEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "financialEvent_financialProfileId_occurredAt_idx" ON "financialEvent"("financialProfileId", "occurredAt");
CREATE INDEX "financialEvent_type_occurredAt_idx" ON "financialEvent"("type", "occurredAt");

CREATE TABLE "companyExpense" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "baseAmount" DECIMAL(24,4),
  "baseCurrency" TEXT,
  "fxRate" DECIMAL(20,10),
  "fxRateAt" TIMESTAMP(3),
  "recurringMonthly" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "description" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "companyExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "companyExpense_active_startDate_endDate_idx" ON "companyExpense"("active", "startDate", "endDate");
CREATE INDEX "companyExpense_category_idx" ON "companyExpense"("category");

CREATE TABLE "companyGoal" (
  "id" TEXT NOT NULL,
  "type" "CompanyGoalType" NOT NULL,
  "name" TEXT NOT NULL,
  "targetAmountBase" DECIMAL(24,4) NOT NULL,
  "currency" TEXT NOT NULL,
  "deadline" TIMESTAMP(3) NOT NULL,
  "milestones" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "companyGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "companyGoal_type_active_deadline_idx" ON "companyGoal"("type", "active", "deadline");

CREATE TABLE "weeklyTarget" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "weekStart" TIMESTAMP(3) NOT NULL,
  "outreachContacts" INTEGER NOT NULL DEFAULT 0,
  "followUps" INTEGER NOT NULL DEFAULT 0,
  "qualifiedOpportunities" INTEGER NOT NULL DEFAULT 0,
  "proposals" INTEGER NOT NULL DEFAULT 0,
  "clientsClosed" INTEGER NOT NULL DEFAULT 0,
  "mrrGeneratedTargetBase" DECIMAL(24,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "weeklyTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "weeklyTarget_userId_weekStart_key" ON "weeklyTarget"("userId", "weekStart");
CREATE INDEX "weeklyTarget_weekStart_idx" ON "weeklyTarget"("weekStart");

CREATE TABLE "workspacePermissionOverride" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workspacePermissionOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspacePermissionOverride_userId_permission_key" ON "workspacePermissionOverride"("userId", "permission");
CREATE INDEX "workspacePermissionOverride_permission_allowed_idx" ON "workspacePermissionOverride"("permission", "allowed");

ALTER TABLE "clientFinancialProfile" ADD CONSTRAINT "clientFinancialProfile_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clientFinancialProfile" ADD CONSTRAINT "clientFinancialProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clientFinancialProfile" ADD CONSTRAINT "clientFinancialProfile_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clientCommission" ADD CONSTRAINT "clientCommission_financialProfileId_fkey" FOREIGN KEY ("financialProfileId") REFERENCES "clientFinancialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clientCommission" ADD CONSTRAINT "clientCommission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financialSnapshot" ADD CONSTRAINT "financialSnapshot_financialProfileId_fkey" FOREIGN KEY ("financialProfileId") REFERENCES "clientFinancialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financialEvent" ADD CONSTRAINT "financialEvent_financialProfileId_fkey" FOREIGN KEY ("financialProfileId") REFERENCES "clientFinancialProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financialEvent" ADD CONSTRAINT "financialEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "companyExpense" ADD CONSTRAINT "companyExpense_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "companyGoal" ADD CONSTRAINT "companyGoal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weeklyTarget" ADD CONSTRAINT "weeklyTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspacePermissionOverride" ADD CONSTRAINT "workspacePermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspacePermissionOverride" ADD CONSTRAINT "workspacePermissionOverride_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clientFinancialProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clientFinancialProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "clientCommission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clientCommission" FORCE ROW LEVEL SECURITY;
ALTER TABLE "financialSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financialSnapshot" FORCE ROW LEVEL SECURITY;
ALTER TABLE "financialEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financialEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "companyExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companyExpense" FORCE ROW LEVEL SECURITY;
ALTER TABLE "companyGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companyGoal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "weeklyTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weeklyTarget" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workspacePermissionOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspacePermissionOverride" FORCE ROW LEVEL SECURITY;

CREATE POLICY client_financial_profile_access ON "clientFinancialProfile" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY client_commission_access ON "clientCommission" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY financial_snapshot_access ON "financialSnapshot" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY financial_event_access ON "financialEvent" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY company_expense_access ON "companyExpense" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY company_goal_access ON "companyGoal" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY weekly_target_access ON "weeklyTarget" FOR ALL
  USING (ibl_current_workspace_role() IS NOT NULL)
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY permission_override_admin ON "workspacePermissionOverride" FOR ALL
  USING (ibl_current_workspace_role() = 'admin')
  WITH CHECK (ibl_current_workspace_role() = 'admin');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibl_v2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "clientFinancialProfile", "clientCommission", "financialSnapshot", "financialEvent",
      "companyExpense", "companyGoal", "weeklyTarget", "workspacePermissionOverride"
    TO ibl_v2_app;
  END IF;
END
$$;

DROP POLICY financial_event_access ON "financialEvent";
CREATE POLICY financial_event_read ON "financialEvent" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY financial_event_insert ON "financialEvent" FOR INSERT
  WITH CHECK (ibl_current_workspace_role() IS NOT NULL);
CREATE TRIGGER financial_event_immutable
  BEFORE UPDATE OR DELETE ON "financialEvent"
  FOR EACH ROW EXECUTE FUNCTION ibl_reject_immutable_change();

DROP POLICY permission_override_admin ON "workspacePermissionOverride";
CREATE POLICY permission_override_read ON "workspacePermissionOverride" FOR SELECT
  USING (ibl_current_workspace_role() IS NOT NULL);
CREATE POLICY permission_override_admin_insert ON "workspacePermissionOverride" FOR INSERT
  WITH CHECK (ibl_current_workspace_role() = 'admin');
CREATE POLICY permission_override_admin_update ON "workspacePermissionOverride" FOR UPDATE
  USING (ibl_current_workspace_role() = 'admin')
  WITH CHECK (ibl_current_workspace_role() = 'admin');
CREATE POLICY permission_override_admin_delete ON "workspacePermissionOverride" FOR DELETE
  USING (ibl_current_workspace_role() = 'admin');
