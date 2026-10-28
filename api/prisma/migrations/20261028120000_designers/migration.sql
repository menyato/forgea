-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DESIGNER';

-- AlterTable
ALTER TABLE "custom_requests" ADD COLUMN     "designPreviewKey" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "designer" TEXT;


-- ---------------------------------------------------------------------------
-- Hand-written constraints.
-- ---------------------------------------------------------------------------

ALTER TABLE "products" ADD CONSTRAINT "products_designer_check"
  CHECK ("designer" IS NULL OR char_length("designer") BETWEEN 1 AND 100);
-- Files are object keys, never URLs (same format as STORAGE_KEY_PATTERN).
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_keys_check" CHECK (
  ("fileKey" IS NULL OR "fileKey" ~ '^clean/[0-9a-f-]{36}\.[a-z0-9]{2,5}$')
  AND ("designPreviewKey" IS NULL OR "designPreviewKey" ~ '^clean/[0-9a-f-]{36}\.[a-z0-9]{2,5}$')
);
