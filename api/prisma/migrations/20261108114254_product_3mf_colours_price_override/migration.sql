-- A product's own selling price in place of the calculated one, and the grams per filament
-- colour of a multi-colour product (from its 3MF).

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "priceOverride" DECIMAL(10,2);
ALTER TABLE "products" ADD CONSTRAINT "products_priceOverride_positive"
  CHECK ("priceOverride" IS NULL OR "priceOverride" > 0);

-- CreateTable
CREATE TABLE "product_colours" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "grams" DECIMAL(10,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_colours_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_colours_grams_positive" CHECK ("grams" > 0),
    CONSTRAINT "product_colours_hex_format" CHECK ("hex" ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT "product_colours_colour_named"
      CHECK (length(btrim("colour")) BETWEEN 1 AND 40)
);

-- CreateIndex
CREATE UNIQUE INDEX "product_colours_productId_colour_key" ON "product_colours"("productId", "colour");

-- AddForeignKey
ALTER TABLE "product_colours" ADD CONSTRAINT "product_colours_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
