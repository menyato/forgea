-- CreateEnum
CREATE TYPE "ProfitKind" AS ENUM ('PERCENT', 'FIXED');

-- A material's cost comes from one reel as bought: its price and weight.
ALTER TABLE "materials" ADD COLUMN "reelGrams" INTEGER,
ADD COLUMN "reelPrice" DECIMAL(10,2);

-- Hand-written: every material starts as a 1000 g reel at today's price per gram, so prices
-- don't move; the owner then types what their reels really cost.
UPDATE "materials" SET "reelGrams" = 1000, "reelPrice" = round("pricePerGram" * 1000, 2);

ALTER TABLE "materials" ADD CONSTRAINT "materials_reel"
  CHECK (("reelPrice" IS NULL) = ("reelGrams" IS NULL)
         AND ("reelGrams" IS NULL OR "reelGrams" > 0)
         AND ("reelPrice" IS NULL OR "reelPrice" >= 0));

-- The shop's profit rule replaces the markup multiplier: ×2.5 becomes 150 %, the same prices.
ALTER TABLE "pricing_settings"
ADD COLUMN "electricityPerKwh" DECIMAL(8,4),
ADD COLUMN "printerLifeHours" INTEGER,
ADD COLUMN "printerPrice" DECIMAL(10,2),
ADD COLUMN "printerWatts" INTEGER,
ADD COLUMN "profitKind" "ProfitKind" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN "profitValue" DECIMAL(10,2);

UPDATE "pricing_settings" SET "profitValue" = round(("markupMultiplier" - 1) * 100, 2);
ALTER TABLE "pricing_settings" ALTER COLUMN "profitValue" SET NOT NULL;
ALTER TABLE "pricing_settings" DROP COLUMN "markupMultiplier";

ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_profit"
  CHECK ("profitValue" >= 0 AND ("profitKind" = 'FIXED' OR "profitValue" <= 1000));
-- The printer's details come all together (the hourly rate is worked out from them) or not at all.
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_printer"
  CHECK ((("printerPrice" IS NULL) AND ("printerLifeHours" IS NULL) AND ("printerWatts" IS NULL)
          AND ("electricityPerKwh" IS NULL))
      OR (("printerPrice" >= 0) AND ("printerLifeHours" > 0) AND ("printerWatts" >= 0)
          AND ("electricityPerKwh" >= 0)));

-- A product's own profit rule: both parts or neither (neither = the shop's).
ALTER TABLE "products" ADD COLUMN "profitKind" "ProfitKind",
ADD COLUMN "profitValue" DECIMAL(10,2);

ALTER TABLE "products" ADD CONSTRAINT "products_profit"
  CHECK (("profitKind" IS NULL) = ("profitValue" IS NULL)
         AND ("profitValue" IS NULL OR "profitValue" >= 0)
         AND ("profitKind" IS DISTINCT FROM 'PERCENT' OR "profitValue" <= 1000));
