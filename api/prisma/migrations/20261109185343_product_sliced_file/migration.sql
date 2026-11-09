-- AlterTable
ALTER TABLE "products" ADD COLUMN     "slicedFile" BOOLEAN NOT NULL DEFAULT false;

-- Only a product whose model is a 3MF can carry its sliced numbers.
ALTER TABLE "products" ADD CONSTRAINT "products_sliced_file_check"
  CHECK (NOT "slicedFile" OR "modelFileKey" LIKE '%.3mf');
