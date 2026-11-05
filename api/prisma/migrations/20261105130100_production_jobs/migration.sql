-- Production, connected: print jobs print an order line, on a chosen printer, from a chosen
-- reel (no more typed machine names or colours), and record what they really took and cost.

-- Printers -------------------------------------------------------------------------------
CREATE TABLE "printers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "watts" INTEGER NOT NULL,
    "priceUsd" DECIMAL(10,2),
    "lifeHours" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "printers_name_key" ON "printers"("name");
ALTER TABLE "printers" ADD CONSTRAINT "printers_values" CHECK (
  "name" = btrim("name") AND length("name") BETWEEN 1 AND 60
  AND "watts" BETWEEN 1 AND 5000
  AND (("priceUsd" IS NULL) = ("lifeHours" IS NULL))
  AND ("priceUsd" IS NULL OR "priceUsd" >= 0)
  AND ("lifeHours" IS NULL OR "lifeHours" > 0)
);

-- Every machine name the jobs used becomes a printer, with the shop's printer settings (or
-- 150 W); with none, one "Printer 1", so jobs made from now on have one to choose.
INSERT INTO "printers" ("id", "name", "watts", "priceUsd", "lifeHours", "updatedAt")
SELECT gen_random_uuid(), j."name", COALESCE(p."printerWatts", 150),
       CASE WHEN p."printerLifeHours" IS NOT NULL THEN p."printerPrice" END,
       CASE WHEN p."printerPrice" IS NOT NULL THEN p."printerLifeHours" END,
       CURRENT_TIMESTAMP
FROM (SELECT DISTINCT left(btrim("machine"), 60) AS "name" FROM "print_jobs"
      WHERE btrim("machine") <> '') j
LEFT JOIN "pricing_settings" p ON p."id" = 1;
INSERT INTO "printers" ("id", "name", "watts", "priceUsd", "lifeHours", "updatedAt")
SELECT gen_random_uuid(), 'Printer 1', COALESCE(p."printerWatts", 150),
       CASE WHEN p."printerLifeHours" IS NOT NULL THEN p."printerPrice" END,
       CASE WHEN p."printerPrice" IS NOT NULL THEN p."printerLifeHours" END,
       CURRENT_TIMESTAMP
FROM (SELECT 1) one LEFT JOIN "pricing_settings" p ON p."id" = 1
WHERE NOT EXISTS (SELECT 1 FROM "printers");

-- Print jobs -----------------------------------------------------------------------------
ALTER TABLE "print_jobs"
  ADD COLUMN "orderItemId" UUID,
  ADD COLUMN "printerId" UUID,
  ADD COLUMN "stockItemId" UUID,
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "actualGrams" DECIMAL(10,2),
  ADD COLUMN "actualHours" DECIMAL(8,2),
  ADD COLUMN "finishedAt" TIMESTAMPTZ(3),
  ADD COLUMN "materialCost" DECIMAL(12,2),
  ADD COLUMN "electricityKwh" DECIMAL(10,3),
  ADD COLUMN "electricityCost" DECIMAL(12,2),
  ADD COLUMN "wearCost" DECIMAL(12,2);

UPDATE "print_jobs" j SET "printerId" = p."id"
FROM "printers" p WHERE p."name" = left(btrim(j."machine"), 60);

-- Each material + colour the jobs used is a reel in stock (made if missing).
INSERT INTO "stock_items" ("id", "materialId", "colour", "lowStockGrams", "updatedAt")
SELECT gen_random_uuid(), j."materialId", j."colour", 0, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "materialId", btrim("color") AS "colour" FROM "print_jobs") j
ON CONFLICT ("materialId", "colour") DO NOTHING;
UPDATE "print_jobs" j SET "stockItemId" = s."id"
FROM "stock_items" s WHERE s."materialId" = j."materialId" AND s."colour" = btrim(j."color");

-- Jobs finished before this kept no actual figures: their estimate stands in.
UPDATE "print_jobs"
SET "actualGrams" = "grams", "actualHours" = "hours", "finishedAt" = "updatedAt"
WHERE "status" = 'DONE';

ALTER TABLE "print_jobs" DROP CONSTRAINT "print_jobs_materialId_fkey";
ALTER TABLE "print_jobs" DROP COLUMN "machine", DROP COLUMN "color", DROP COLUMN "materialId";

ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "printers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "print_jobs_orderItemId_idx" ON "print_jobs"("orderItemId");
CREATE INDEX "print_jobs_printerId_idx" ON "print_jobs"("printerId");

ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_values" CHECK (
  "quantity" > 0 AND "grams" >= 0 AND "hours" >= 0
  AND ("actualGrams" IS NULL OR "actualGrams" >= 0)
  AND ("actualHours" IS NULL OR "actualHours" >= 0)
  AND ("materialCost" IS NULL OR "materialCost" >= 0)
  AND ("electricityKwh" IS NULL OR "electricityKwh" >= 0)
  AND ("electricityCost" IS NULL OR "electricityCost" >= 0)
  AND ("wearCost" IS NULL OR "wearCost" >= 0)
);
-- Scheduled, printing or done: always on a printer, from a reel.
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_ready" CHECK (
  "status" NOT IN ('SCHEDULED', 'PRINTING', 'DONE')
  OR ("printerId" IS NOT NULL AND "stockItemId" IS NOT NULL)
);
-- Done: what it really took is known.
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_done" CHECK (
  "status" <> 'DONE'
  OR ("actualGrams" IS NOT NULL AND "actualHours" IS NOT NULL AND "finishedAt" IS NOT NULL)
);

-- Stock: a finished job's movement is PRINTED, always tied to its job.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_failed_print";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_print_job" CHECK (
  ("printJobId" IS NULL OR "kind" IN ('FAILED_PRINT', 'PRINTED'))
  AND ("kind" <> 'FAILED_PRINT' OR "printJobId" IS NOT NULL OR "productId" IS NOT NULL)
  AND ("kind" <> 'PRINTED' OR "printJobId" IS NOT NULL)
);
