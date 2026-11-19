-- AlterTable
ALTER TABLE "products" ADD COLUMN     "studioOnly" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written: a studio-only product is never in the shop.
ALTER TABLE "products" ADD CONSTRAINT "products_studioOnly_hidden"
  CHECK (NOT ("studioOnly" AND "active"));
