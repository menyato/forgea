-- CreateEnum
CREATE TYPE "TextStyle" AS ENUM ('KEYCHAIN', 'NAME', 'MONOGRAM', 'LETTERS');

-- AlterEnum
ALTER TYPE "UploadPurpose" ADD VALUE 'FONT';

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "design" JSONB;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "design" JSONB;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "textBaseMm" DECIMAL(5,1),
ADD COLUMN     "textColourGroupId" UUID,
ADD COLUMN     "textDepthMm" DECIMAL(5,1),
ADD COLUMN     "textExtraColourPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "textHeightMm" DECIMAL(6,1),
ADD COLUMN     "textMaxChars" INTEGER,
ADD COLUMN     "textMaxWidthMm" DECIMAL(6,1),
ADD COLUMN     "textStyle" "TextStyle";

-- CreateTable
CREATE TABLE "fonts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "latin" BOOLEAN NOT NULL DEFAULT false,
    "arabic" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fonts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fonts_name_key" ON "fonts"("name");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_textColourGroupId_fkey" FOREIGN KEY ("textColourGroupId") REFERENCES "option_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: a personalised product has every setting, in a range that prints; a regular
-- product has none of them.
ALTER TABLE "products" ADD CONSTRAINT "products_text_settings" CHECK (
  ("textStyle" IS NULL
    AND "textMaxChars" IS NULL AND "textHeightMm" IS NULL AND "textDepthMm" IS NULL
    AND "textBaseMm" IS NULL AND "textMaxWidthMm" IS NULL AND "textColourGroupId" IS NULL)
  OR ("textStyle" IS NOT NULL
    AND "textMaxChars" BETWEEN 1 AND 24
    AND "textHeightMm" BETWEEN 5 AND 200
    AND "textDepthMm" BETWEEN 0.6 AND 30
    AND "textBaseMm" BETWEEN 0.6 AND 30
    AND "textMaxWidthMm" BETWEEN 10 AND 400
    AND "textColourGroupId" IS NOT NULL)
);
ALTER TABLE "products" ADD CONSTRAINT "products_text_extra_colour_price"
  CHECK ("textExtraColourPrice" >= 0);

ALTER TABLE "fonts" ADD CONSTRAINT "fonts_name"
  CHECK (length("name") BETWEEN 1 AND 60 AND "name" = btrim("name"));

-- A design is always an object (the API validates its contents).
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_design"
  CHECK ("design" IS NULL OR jsonb_typeof("design") = 'object');
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_design"
  CHECK ("design" IS NULL OR jsonb_typeof("design") = 'object');

-- A multi-colour piece takes from each colour's reel: an order line is taken out of stock once
-- per reel (material + colour), not once in all; running twice still takes nothing more.
DROP INDEX "stock_movements_one_per_order_line";
CREATE UNIQUE INDEX "stock_movements_one_per_order_line_reel"
  ON "stock_movements" ("orderItemId", "stockItemId") WHERE "kind" = 'ORDER';
