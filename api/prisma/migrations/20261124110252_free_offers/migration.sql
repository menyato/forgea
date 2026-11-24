-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "freeOfferId" UUID;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "freeOfferId" UUID;

-- CreateTable
CREATE TABLE "free_offers" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "maxClaims" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "free_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "free_offers_active_startsAt_endsAt_idx" ON "free_offers"("active", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_freeOfferId_fkey" FOREIGN KEY ("freeOfferId") REFERENCES "free_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "free_offers" ADD CONSTRAINT "free_offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_freeOfferId_fkey" FOREIGN KEY ("freeOfferId") REFERENCES "free_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written checks.
-- An offer runs for a while, gives a positive number of pieces if limited, and says something.
ALTER TABLE "free_offers" ADD CONSTRAINT "free_offers_window_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "free_offers" ADD CONSTRAINT "free_offers_max_claims_check" CHECK ("maxClaims" IS NULL OR "maxClaims" > 0);
ALTER TABLE "free_offers" ADD CONSTRAINT "free_offers_title_check" CHECK (char_length("title") BETWEEN 1 AND 80 AND "title" = btrim("title"));
ALTER TABLE "free_offers" ADD CONSTRAINT "free_offers_description_check" CHECK ("description" IS NULL OR char_length("description") <= 300);
-- A free line is one piece; on an order it costs nothing.
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_free_one_check" CHECK ("freeOfferId" IS NULL OR "quantity" = 1);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_free_check" CHECK ("freeOfferId" IS NULL OR ("quantity" = 1 AND "unitPrice" = 0));
-- Claims are counted per offer.
CREATE INDEX "order_items_freeOfferId_idx" ON "order_items"("freeOfferId");
