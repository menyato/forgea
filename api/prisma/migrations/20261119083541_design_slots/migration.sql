-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "slotChoices" JSONB;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "slots" JSONB;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "designSlots" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "logos" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "outline" JSONB NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "logos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logos_name_key" ON "logos"("name");

-- Hand-written: what the API checks, held by the database too.
ALTER TABLE "products" ADD CONSTRAINT "products_designSlots_array"
  CHECK (jsonb_typeof("designSlots") = 'array' AND jsonb_array_length("designSlots") <= 8);
ALTER TABLE "logos" ADD CONSTRAINT "logos_outline_array"
  CHECK (jsonb_typeof("outline") = 'array' AND "points" >= 3);
ALTER TABLE "logos" ADD CONSTRAINT "logos_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_slotChoices_object"
  CHECK ("slotChoices" IS NULL OR jsonb_typeof("slotChoices") = 'object');
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_slots_array"
  CHECK ("slots" IS NULL OR jsonb_typeof("slots") = 'array');
