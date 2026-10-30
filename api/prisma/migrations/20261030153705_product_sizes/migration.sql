-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sizeXcm" DECIMAL(7,1),
ADD COLUMN     "sizeYcm" DECIMAL(7,1),
ADD COLUMN     "sizeZcm" DECIMAL(7,1);

-- CreateTable
CREATE TABLE "product_sizes" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "sizeXcm" DECIMAL(7,1) NOT NULL,
    "sizeYcm" DECIMAL(7,1) NOT NULL,
    "sizeZcm" DECIMAL(7,1) NOT NULL,
    "grams" DECIMAL(10,2) NOT NULL,
    "printHours" DECIMAL(8,2) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_sizes_productId_label_key" ON "product_sizes"("productId", "label");

-- AddForeignKey
ALTER TABLE "product_sizes" ADD CONSTRAINT "product_sizes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: real measurements only.
ALTER TABLE "products" ADD CONSTRAINT "products_size"
  CHECK (("sizeXcm" IS NULL AND "sizeYcm" IS NULL AND "sizeZcm" IS NULL)
      OR ("sizeXcm" > 0 AND "sizeYcm" > 0 AND "sizeZcm" > 0));
ALTER TABLE "product_sizes" ADD CONSTRAINT "product_sizes_measures"
  CHECK ("sizeXcm" > 0 AND "sizeYcm" > 0 AND "sizeZcm" > 0
     AND "grams" > 0 AND "printHours" > 0
     AND char_length("label") BETWEEN 1 AND 40);
-- At most one default size per product.
CREATE UNIQUE INDEX "product_sizes_one_default" ON "product_sizes" ("productId") WHERE "isDefault";
