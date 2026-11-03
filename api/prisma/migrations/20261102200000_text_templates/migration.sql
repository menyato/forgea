-- Decorated templates: a big initial with the name across it and decorations, and two names
-- with a heart. An accent colour (the initial and decorations, or the heart) with its default.

-- CreateEnum
CREATE TYPE "TextDecor" AS ENUM ('HEARTS', 'FLOWERS', 'STARS', 'CROWN');

-- AlterEnum
ALTER TYPE "TextStyle" ADD VALUE 'INITIAL_NAME';
ALTER TYPE "TextStyle" ADD VALUE 'COUPLE';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "textDecor" "TextDecor",
ADD COLUMN     "textDefaultAccentId" UUID;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_textDefaultAccentId_fkey" FOREIGN KEY ("textDefaultAccentId") REFERENCES "option_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: decorations belong to (and are required by) a big initial. Compared as text:
-- the new enum values can't be used in the transaction that adds them.
ALTER TABLE "products" ADD CONSTRAINT "products_text_decor" CHECK (
  ("textDecor" IS NOT NULL) = coalesce("textStyle"::text = 'INITIAL_NAME', false)
);
