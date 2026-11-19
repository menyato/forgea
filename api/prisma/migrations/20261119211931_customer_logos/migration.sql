-- AlterTable
ALTER TABLE "products" ADD COLUMN     "textOwnLogo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "customer_logos" (
    "id" UUID NOT NULL,
    "outline" JSONB NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_logos_pkey" PRIMARY KEY ("id")
);

-- Hand-written: what the API checks, held by the database too.
ALTER TABLE "customer_logos" ADD CONSTRAINT "customer_logos_outline_array"
  CHECK (jsonb_typeof("outline") = 'array' AND "points" >= 3);
-- Bringing your own logo belongs to name keychains only.
ALTER TABLE "products" ADD CONSTRAINT "products_textOwnLogo_keychain"
  CHECK (NOT "textOwnLogo" OR "textStyle" = 'KEYCHAIN');
