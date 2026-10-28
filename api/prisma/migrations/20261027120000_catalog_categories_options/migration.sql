-- Dashboard catalog: categories, admin-defined product options with price rules, option
-- choices on cart and order lines, and per-material density/throughput for 3D-model estimates.

-- CreateEnum
CREATE TYPE "OptionKind" AS ENUM ('CHOICE', 'TEXT');

-- DropIndex
DROP INDEX "cart_items_cartId_productId_key";

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "configKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "options" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "densityGPerCm3" DECIMAL(6,3) NOT NULL DEFAULT 1.24,
ADD COLUMN     "gramsPerHour" DECIMAL(8,2) NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "options" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "categoryId" UUID;

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OptionKind" NOT NULL DEFAULT 'CHOICE',
    "maxLength" INTEGER,
    "textExtraPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_values" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "swatchHex" TEXT,
    "gramsMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "hoursMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "extraPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "materialId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_groups" (
    "productId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "productId" UUID NOT NULL,
    "valueId" UUID NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("productId","valueId")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_active_sortOrder_idx" ON "categories"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "option_groups_name_key" ON "option_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "option_values_groupId_label_key" ON "option_values"("groupId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_configKey_key" ON "cart_items"("cartId", "productId", "configKey");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- AddForeignKey
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "option_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "option_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written constraints. Prisma's schema language can't express CHECK.
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "materials" ADD CONSTRAINT "materials_print_rates_check"
  CHECK ("densityGPerCm3" > 0 AND "gramsPerHour" > 0);
-- maxLength belongs to text options only, and a text option must have one.
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_text_check" CHECK (
  ("kind" = 'TEXT' AND "maxLength" BETWEEN 1 AND 200) OR ("kind" = 'CHOICE' AND "maxLength" IS NULL)
);
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_text_price_check" CHECK ("textExtraPrice" >= 0);
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_effects_check"
  CHECK ("gramsMultiplier" > 0 AND "hoursMultiplier" > 0 AND "extraPrice" >= 0);
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_swatch_check"
  CHECK ("swatchHex" IS NULL OR "swatchHex" ~ '^#[0-9a-f]{6}$');
