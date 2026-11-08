-- AlterTable
ALTER TABLE "product_colours" ADD COLUMN     "part" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "partColourGroupId" UUID;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_partColourGroupId_fkey" FOREIGN KEY ("partColourGroupId") REFERENCES "option_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A part customers recolour has a name they read: 1–40 characters, no surrounding spaces.
ALTER TABLE "product_colours" ADD CONSTRAINT "product_colours_part_check"
  CHECK ("part" IS NULL OR (char_length("part") BETWEEN 1 AND 40 AND "part" = btrim("part")));
