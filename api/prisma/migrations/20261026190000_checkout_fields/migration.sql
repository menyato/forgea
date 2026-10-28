-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "customerName" TEXT NOT NULL,
ADD COLUMN     "delivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "idempotencyKey" UUID,
ADD COLUMN     "phone" TEXT NOT NULL,
ADD COLUMN     "rush" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");


-- Hand-written constraints.
-- Delivery orders need somewhere to deliver to; pickup orders don't.
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_address_check" CHECK (
  NOT "delivery" OR ("city" IS NOT NULL AND "addressLine" IS NOT NULL)
);
-- Order numbers are random and unguessable: "FG-" + 10 Crockford base32 characters.
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_number_format_check" CHECK (
  "orderNumber" ~ '^FG-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'
);
