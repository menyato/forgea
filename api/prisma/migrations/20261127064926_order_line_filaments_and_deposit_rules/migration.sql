-- AlterTable
ALTER TABLE "pricing_settings" ADD COLUMN     "depositAboveTotal" DECIMAL(10,2) DEFAULT 30,
ADD COLUMN     "depositEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "depositOnCustom" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "order_item_filaments" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "stockItemId" UUID NOT NULL,

    CONSTRAINT "order_item_filaments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_item_filaments_stockItemId_idx" ON "order_item_filaments"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_filaments_orderItemId_colour_key" ON "order_item_filaments"("orderItemId", "colour");

-- AddForeignKey
ALTER TABLE "order_item_filaments" ADD CONSTRAINT "order_item_filaments_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_filaments" ADD CONSTRAINT "order_item_filaments_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A deposit threshold is a real amount.
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_deposit_above_check"
  CHECK ("depositAboveTotal" IS NULL OR "depositAboveTotal" > 0);
