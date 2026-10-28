/*
  Warnings:

  - Added the required column `totalInCurrency` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "currencyCode" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "depositInCurrency" DECIMAL(20,4) NOT NULL DEFAULT 0,
ADD COLUMN     "exchangeRate" DECIMAL(20,8) NOT NULL DEFAULT 1,
ADD COLUMN     "totalInCurrency" DECIMAL(20,4) NOT NULL;

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "roundingStep" DECIMAL(18,6) NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rates_currencyCode_effectiveFrom_idx" ON "exchange_rates"("currencyCode", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints.
-- ---------------------------------------------------------------------------

ALTER TABLE "currencies" ADD CONSTRAINT "currencies_values_check" CHECK (
  "code" ~ '^[A-Z]{3}$' AND "decimals" BETWEEN 0 AND 4 AND "roundingStep" > 0
);
-- Exactly one base currency: a unique index over the single value TRUE.
CREATE UNIQUE INDEX "currencies_single_base" ON "currencies" ("isBase") WHERE "isBase";
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_rate_check" CHECK ("rate" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_amounts_check" CHECK (
  "exchangeRate" > 0 AND "totalInCurrency" >= 0 AND "depositInCurrency" >= 0
);

-- ---------------------------------------------------------------------------
-- Defaults (2026-10-26, see docs/PRICING.md). The owner sets real rates in the dashboard.
-- ---------------------------------------------------------------------------

INSERT INTO "currencies" ("code", "name", "decimals", "roundingStep", "isBase", "active", "updatedAt") VALUES
  ('USD', 'US dollar', 2, 0.01, true, true, CURRENT_TIMESTAMP),
  ('LBP', 'Lebanese pound', 0, 5000, false, true, CURRENT_TIMESTAMP);

-- ~89,500 LBP per USD (market rate, spring 2026).
INSERT INTO "exchange_rates" ("id", "currencyCode", "rate") VALUES
  ('019a2000-0000-7000-8000-00000000c001', 'LBP', 89500);

-- Pricing moves from Qatar/QAR to Lebanon/USD. Each UPDATE matches the previous default,
-- so values an admin has already changed are left alone.
UPDATE "pricing_settings" SET "machineRatePerHour" = 1.50, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1 AND "machineRatePerHour" = 6.00;
UPDATE "pricing_settings" SET "laborCostPerUnit" = 1.50, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1 AND "laborCostPerUnit" = 5.00;
UPDATE "pricing_settings" SET "packagingCostPerUnit" = 0.75, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1 AND "packagingCostPerUnit" = 3.00;
-- Greater Beirut couriers charge about $3–6 per parcel.
UPDATE "pricing_settings" SET "deliveryFee" = 5.00, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1 AND "deliveryFee" = 25.00;

-- Beirut retail: PLA $18–24 per kg.
UPDATE "materials" SET "pricePerGram" = 0.0200, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'PLA' AND "pricePerGram" = 0.1000;
UPDATE "materials" SET "pricePerGram" = 0.0220, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'PETG' AND "pricePerGram" = 0.1100;
UPDATE "materials" SET "pricePerGram" = 0.0250, "updatedAt" = CURRENT_TIMESTAMP WHERE "code" = 'ASA' AND "pricePerGram" = 0.1200;
