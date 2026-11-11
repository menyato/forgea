-- AlterTable
ALTER TABLE "option_values" ADD COLUMN     "stockItemId" UUID;

-- AddForeignKey
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
