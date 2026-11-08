-- Phase B: 3MF files on quotation lines, custom requests and their orders; and whether a
-- customer's sliced 3MF is quoted at once.

-- AlterEnum
ALTER TYPE "UploadPurpose" ADD VALUE 'QUOTATION_FILE';

-- AlterTable
ALTER TABLE "custom_requests" ADD COLUMN     "printFile" JSONB;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "printFile" JSONB;

-- AlterTable
ALTER TABLE "quotation_lines" ADD COLUMN     "printFile" JSONB;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "autoQuoteSlicedFiles" BOOLEAN NOT NULL DEFAULT true;

-- A print file is always a JSON object (PrintFile in @forgea/types), naming its file.
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_printFile_object"
  CHECK ("printFile" IS NULL OR (jsonb_typeof("printFile") = 'object' AND "printFile" ? 'fileKey'));
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_printFile_object"
  CHECK ("printFile" IS NULL OR (jsonb_typeof("printFile") = 'object' AND "printFile" ? 'fileKey'));
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_printFile_object"
  CHECK ("printFile" IS NULL OR (jsonb_typeof("printFile") = 'object' AND "printFile" ? 'fileKey'));
