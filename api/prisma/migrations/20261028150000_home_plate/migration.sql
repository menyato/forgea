-- AlterTable
ALTER TABLE "products" ADD COLUMN     "plateOrder" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "products_plateOrder_key" ON "products"("plateOrder");


-- Hand-written: the bed has a centre and four corners.
ALTER TABLE "products" ADD CONSTRAINT "products_plate_order_check" CHECK ("plateOrder" IS NULL OR "plateOrder" BETWEEN 1 AND 5);
