ALTER TABLE "clientFinancialProfile" DROP CONSTRAINT "clientFinancialProfile_dealId_fkey";
ALTER TABLE "clientFinancialProfile" ADD CONSTRAINT "clientFinancialProfile_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clientFinancialProfile" DROP CONSTRAINT "clientFinancialProfile_companyId_fkey";
ALTER TABLE "clientFinancialProfile" ADD CONSTRAINT "clientFinancialProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clientFinancialProfile" DROP CONSTRAINT "clientFinancialProfile_contactId_fkey";
ALTER TABLE "clientFinancialProfile" ADD CONSTRAINT "clientFinancialProfile_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
