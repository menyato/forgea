-- AlterTable
ALTER TABLE "products" ADD COLUMN     "priceLinesOff" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Only the shop's price lines (PRICE_LINES in @forgea/types).
ALTER TABLE "products" ADD CONSTRAINT "products_price_lines_off_known"
  CHECK ("priceLinesOff" <@ ARRAY['material', 'machine', 'waste', 'failure', 'labor', 'packaging', 'profit']::TEXT[]);
