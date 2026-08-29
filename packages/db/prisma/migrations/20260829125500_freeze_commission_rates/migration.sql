ALTER TABLE "clientCommission"
ADD COLUMN "baseCurrency" TEXT,
ADD COLUMN "fxRate" DECIMAL(20,10),
ADD COLUMN "fxRateAt" TIMESTAMP(3);
