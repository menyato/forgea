-- AlterTable
ALTER TABLE "product_colours" ADD COLUMN     "startsAs" TEXT;

-- Only a part starts somewhere, and a label is 1-40 characters.
ALTER TABLE "product_colours" ADD CONSTRAINT "product_colours_starts_as_check"
  CHECK ("startsAs" IS NULL OR ("part" IS NOT NULL AND char_length("startsAs") BETWEEN 1 AND 40));
