-- Customers may bring their own logo to name keychains and to pieces they design freely
-- (a standing initial, a trophy), where it is one of the things they place.
ALTER TABLE "products" DROP CONSTRAINT "products_textOwnLogo_keychain";
ALTER TABLE "products" ADD CONSTRAINT "products_textOwnLogo_keychain"
  CHECK (NOT "textOwnLogo" OR "textStyle" IN ('KEYCHAIN', 'STANDING_INITIAL', 'TROPHY'));
