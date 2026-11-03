-- AlterTable
ALTER TABLE "products" ADD COLUMN     "textDefaultBaseId" UUID,
ADD COLUMN     "textDefaultColourId" UUID,
ADD COLUMN     "textSizesMm" DECIMAL(6,1)[] DEFAULT ARRAY[]::DECIMAL(6,1)[];

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_textDefaultColourId_fkey" FOREIGN KEY ("textDefaultColourId") REFERENCES "option_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_textDefaultBaseId_fkey" FOREIGN KEY ("textDefaultBaseId") REFERENCES "option_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: never null, at most 6 more sizes, each a height that prints (as textHeightMm).
UPDATE "products" SET "textSizesMm" = ARRAY[]::DECIMAL(6,1)[] WHERE "textSizesMm" IS NULL;
ALTER TABLE "products" ALTER COLUMN "textSizesMm" SET NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_text_sizes" CHECK (
  coalesce(array_length("textSizesMm", 1), 0) <= 6
  AND 5 <= ALL ("textSizesMm") AND 200 >= ALL ("textSizesMm")
);
