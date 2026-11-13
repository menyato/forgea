-- The printer's price, life and watts are entered once, on the printer (Dashboard → Printers):
-- pricing reads them from the printer it names. What the Pricing page held moves there first.

-- With one printer and nothing typed on it yet, it takes the Pricing page's price and life.
UPDATE "printers" p
SET "priceUsd" = s."printerPrice", "lifeHours" = s."printerLifeHours"
FROM "pricing_settings" s
WHERE s."id" = 1
  AND s."printerPrice" IS NOT NULL
  AND s."printerLifeHours" IS NOT NULL
  AND p."priceUsd" IS NULL
  AND p."lifeHours" IS NULL
  AND (SELECT count(*) FROM "printers") = 1;

ALTER TABLE "pricing_settings" ADD COLUMN "pricingPrinterId" UUID;

-- Prices came from the printer's details: they now come from the studio's printer (the only
-- one in use).
UPDATE "pricing_settings" s
SET "pricingPrinterId" = (SELECT "id" FROM "printers" WHERE "active" ORDER BY "name" LIMIT 1)
WHERE s."printerPrice" IS NOT NULL
  AND (SELECT count(*) FROM "printers" WHERE "active") = 1;

-- Dropping the columns drops the old all-four-or-none CHECK with them.
ALTER TABLE "pricing_settings" DROP COLUMN "printerLifeHours",
DROP COLUMN "printerPrice",
DROP COLUMN "printerWatts";

ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_electricity"
  CHECK ("electricityPerKwh" IS NULL OR "electricityPerKwh" >= 0);

-- AddForeignKey
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_pricingPrinterId_fkey" FOREIGN KEY ("pricingPrinterId") REFERENCES "printers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
