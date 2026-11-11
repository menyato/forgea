-- AlterTable
ALTER TABLE "product_colours" ADD COLUMN     "stockItemId" UUID;

-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "pricePerGram" DECIMAL(10,4);

-- AddForeignKey
ALTER TABLE "product_colours" ADD CONSTRAINT "product_colours_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_price_check"
  CHECK ("pricePerGram" IS NULL OR "pricePerGram" > 0);

-- Each filament starts with what its latest delivery cost per gram, when one was recorded.
UPDATE "stock_items" i
SET "pricePerGram" = r."costPerGram"
FROM (
  SELECT DISTINCT ON (s."stockItemId") s."stockItemId", s."costPerGram"
  FROM "stock_movements" s
  WHERE s.kind = 'RECEIVED' AND s."costPerGram" IS NOT NULL AND s."costPerGram" > 0
  ORDER BY s."stockItemId", s."createdAt" DESC
) r
WHERE r."stockItemId" = i.id;
