-- AlterEnum
ALTER TYPE "TextStyle" ADD VALUE 'STANDING_LOGO';

-- A logo standing takes the customer's own logo too (compared as text: the new value can't be
-- used in the transaction that adds it).
ALTER TABLE "products" DROP CONSTRAINT "products_textOwnLogo_keychain";
ALTER TABLE "products" ADD CONSTRAINT "products_textOwnLogo_keychain"
  CHECK (NOT "textOwnLogo" OR "textStyle"::text IN ('KEYCHAIN', 'STANDING_INITIAL', 'TROPHY', 'STANDING_LOGO'));
