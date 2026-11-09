-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "hex" TEXT;

-- How the colour looks: #rrggbb in lowercase.
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_hex_check"
  CHECK ("hex" IS NULL OR "hex" ~ '^#[0-9a-f]{6}$');
