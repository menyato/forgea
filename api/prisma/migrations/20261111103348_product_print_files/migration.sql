-- CreateTable
CREATE TABLE "product_print_files" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "fileKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grams" DECIMAL(10,2) NOT NULL,
    "printHours" DECIMAL(8,2) NOT NULL,
    "details" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_print_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_print_files_productId_fileKey_key" ON "product_print_files"("productId", "fileKey");

-- AddForeignKey
ALTER TABLE "product_print_files" ADD CONSTRAINT "product_print_files_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What a print file is called, and what it takes.
ALTER TABLE "product_print_files" ADD CONSTRAINT "product_print_files_name_check"
  CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name"));
ALTER TABLE "product_print_files" ADD CONSTRAINT "product_print_files_numbers_check"
  CHECK ("grams" > 0 AND "printHours" > 0);
ALTER TABLE "product_print_files" ADD CONSTRAINT "product_print_files_details_check"
  CHECK (jsonb_typeof("details") = 'object');
ALTER TABLE "product_print_files" ADD CONSTRAINT "product_print_files_key_check"
  CHECK ("fileKey" LIKE 'clean/%.3mf');

-- A product's numbers may now be its print files' total, whatever its model is.
ALTER TABLE "products" DROP CONSTRAINT "products_sliced_file_check";
