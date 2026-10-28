-- Owner decision (2026-10-27): anyone may browse and fill a cart, but placing an order needs
-- a customer account and a phone number. Guest checkout and guest order lookup are removed.

-- Nothing is deployed; the only guest orders are local test orders. They are removed so
-- every order can belong to an account (their items and history cascade).
DELETE FROM "orders" WHERE "userId" IS NULL;

ALTER TABLE "orders" DROP CONSTRAINT "orders_owner_check";
ALTER TABLE "orders" DROP CONSTRAINT "orders_guest_email_lowercase_check";

-- DropIndex
DROP INDEX "orders_guestEmail_idx";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "guestEmail",
ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "store_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "transferPhone" TEXT NOT NULL,
    "transferInstructions" TEXT,
    "whatsappPhone" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints and starting values.
-- ---------------------------------------------------------------------------

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_singleton_check" CHECK ("id" = 1);
-- Same pattern as PHONE_PATTERN in @forgea/validation.
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_phones_check" CHECK (
  "transferPhone" ~ '^\+?[0-9 ()-]{7,20}$' AND "whatsappPhone" ~ '^\+?[0-9 ()-]{7,20}$'
);
ALTER TABLE "users" ADD CONSTRAINT "users_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9 ()-]{7,20}$');

-- The owner's number (Lebanon, +961). Editable in the dashboard; a QR code comes later.
INSERT INTO "store_settings" ("id", "transferPhone", "whatsappPhone", "updatedAt")
VALUES (1, '+961 70 904 044', '+961 70 904 044', CURRENT_TIMESTAMP);
