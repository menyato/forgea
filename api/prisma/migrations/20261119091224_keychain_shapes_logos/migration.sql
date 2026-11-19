-- AlterTable
ALTER TABLE "products" ADD COLUMN     "textLogoIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "textShapes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Hand-written: only the shapes the shop knows, a few at most.
ALTER TABLE "products" ADD CONSTRAINT "products_textShapes_known"
  CHECK ("textShapes" <@ ARRAY['OUTLINE','ROUNDED','OVAL','HEART']::text[]);
ALTER TABLE "products" ADD CONSTRAINT "products_textLogoIds_few"
  CHECK (cardinality("textLogoIds") <= 12);
