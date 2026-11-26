-- AlterTable
ALTER TABLE "custom_requests" ADD COLUMN     "designPrintFile" JSONB;

-- Like printFile: a PrintFile object that names its file.
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_design_print_file_check"
  CHECK ("designPrintFile" IS NULL OR (jsonb_typeof("designPrintFile") = 'object' AND "designPrintFile" ? 'fileKey'));
