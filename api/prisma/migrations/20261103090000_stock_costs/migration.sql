-- Filament with its costs: a delivery's price paid (and the books entry when it was paid), and
-- filament printed for the studio or lost to a failed print, costed and tied to its product.

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "purchasesAccountId" UUID;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "cost" DECIMAL(10,2),
ADD COLUMN     "costPerGram" DECIMAL(10,4),
ADD COLUMN     "journalEntryId" UUID,
ADD COLUMN     "productId" UUID,
ADD COLUMN     "quantity" INTEGER;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_purchasesAccountId_fkey" FOREIGN KEY ("purchasesAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written.
-- Purchases are booked to "Filament and materials used" (5000) where the chart has it.
UPDATE "accounting_settings"
SET "purchasesAccountId" = (SELECT "id" FROM "accounts" WHERE "code" = '5000' AND "type" = 'EXPENSE')
WHERE "purchasesAccountId" IS NULL;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_costs" CHECK (
  ("cost" IS NULL OR "cost" >= 0)
  AND ("costPerGram" IS NULL OR "costPerGram" >= 0)
  AND ("quantity" IS NULL OR "quantity" > 0)
);
-- A product (and how many) only for filament printed for the studio or lost to a failure.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product" CHECK (
  ("productId" IS NULL OR "kind" IN ('USED', 'FAILED_PRINT'))
  AND (("productId" IS NULL) = ("quantity" IS NULL))
);
-- A books entry only for a delivery.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_entry" CHECK (
  "journalEntryId" IS NULL OR "kind" = 'RECEIVED'
);
-- A failed print is now either a planner job's or a product's (recorded on the stock page).
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_failed_print";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_failed_print" CHECK (
  ("printJobId" IS NULL OR "kind" = 'FAILED_PRINT')
  AND ("kind" <> 'FAILED_PRINT' OR "printJobId" IS NOT NULL OR "productId" IS NOT NULL)
);
