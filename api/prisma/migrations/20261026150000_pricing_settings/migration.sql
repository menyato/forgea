-- CreateTable
CREATE TABLE "pricing_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "machineRatePerHour" DECIMAL(10,2) NOT NULL,
    "purgeWastePercent" DECIMAL(5,2) NOT NULL,
    "failureAllowancePercent" DECIMAL(5,2) NOT NULL,
    "laborCostPerUnit" DECIMAL(10,2) NOT NULL,
    "packagingCostPerUnit" DECIMAL(10,2) NOT NULL,
    "markupMultiplier" DECIMAL(6,3) NOT NULL,
    "rushFeePercent" DECIMAL(5,2) NOT NULL,
    "deliveryFee" DECIMAL(10,2) NOT NULL,
    "depositPercent" DECIMAL(5,2) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_discount_tiers" (
    "id" UUID NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bulk_discount_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bulk_discount_tiers_minQuantity_key" ON "bulk_discount_tiers"("minQuantity");

-- AddForeignKey
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints and starting values.
-- ---------------------------------------------------------------------------

-- Exactly one settings row.
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_singleton_check" CHECK ("id" = 1);

ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_values_check" CHECK (
  "machineRatePerHour" >= 0 AND "laborCostPerUnit" >= 0 AND "packagingCostPerUnit" >= 0
  AND "deliveryFee" >= 0 AND "markupMultiplier" > 0
  AND "purgeWastePercent" BETWEEN 0 AND 100
  AND "failureAllowancePercent" BETWEEN 0 AND 100
  AND "rushFeePercent" BETWEEN 0 AND 100
  AND "depositPercent" BETWEEN 0 AND 100
);

ALTER TABLE "bulk_discount_tiers" ADD CONSTRAINT "bulk_discount_tiers_values_check"
  CHECK ("minQuantity" >= 2 AND "percent" BETWEEN 0 AND 100);

-- PLACEHOLDER business values so pricing works out of the box. The owner sets the real
-- numbers in the admin dashboard (Phase 8); every change there is audit-logged.
INSERT INTO "pricing_settings" (
  "id", "machineRatePerHour", "purgeWastePercent", "failureAllowancePercent",
  "laborCostPerUnit", "packagingCostPerUnit", "markupMultiplier",
  "rushFeePercent", "deliveryFee", "depositPercent", "updatedAt"
) VALUES (1, 10.00, 5.00, 10.00, 5.00, 3.00, 1.600, 30.00, 25.00, 50.00, CURRENT_TIMESTAMP);

INSERT INTO "bulk_discount_tiers" ("id", "minQuantity", "percent", "updatedAt") VALUES
  ('019a2000-0000-7000-8000-000000000010', 10, 5.00, CURRENT_TIMESTAMP),
  ('019a2000-0000-7000-8000-000000000025', 25, 10.00, CURRENT_TIMESTAMP),
  ('019a2000-0000-7000-8000-000000000050', 50, 15.00, CURRENT_TIMESTAMP);
