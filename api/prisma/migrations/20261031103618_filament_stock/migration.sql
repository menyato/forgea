-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('OPENING', 'RECEIVED', 'ORDER', 'FAILED_PRINT', 'USED', 'CORRECTION');

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '',
    "lowStockGrams" INTEGER NOT NULL,
    "spoolGrams" INTEGER NOT NULL DEFAULT 1000,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "coverDays" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "grams" INTEGER NOT NULL,
    "orderItemId" UUID,
    "printJobId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_materialId_colour_key" ON "stock_items"("materialId", "colour");

-- CreateIndex
CREATE INDEX "stock_movements_stockItemId_createdAt_idx" ON "stock_movements"("stockItemId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_orderItemId_idx" ON "stock_movements"("orderItemId");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "print_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: the owner's limits make sense, and each kind of movement goes one way.
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_limits"
  CHECK ("lowStockGrams" >= 0 AND "spoolGrams" > 0 AND "leadTimeDays" >= 0 AND "coverDays" >= 0);
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_colour_trimmed"
  CHECK ("colour" = btrim("colour"));

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (
  CASE "kind"
    WHEN 'OPENING' THEN "grams" > 0
    WHEN 'RECEIVED' THEN "grams" > 0
    WHEN 'ORDER' THEN "grams" < 0
    WHEN 'FAILED_PRINT' THEN "grams" < 0
    WHEN 'USED' THEN "grams" < 0
    ELSE "grams" <> 0
  END
);
-- An order line is taken out of stock once, whatever runs twice.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_line"
  CHECK (("kind" = 'ORDER') = ("orderItemId" IS NOT NULL));
CREATE UNIQUE INDEX "stock_movements_one_per_order_line"
  ON "stock_movements" ("orderItemId") WHERE "kind" = 'ORDER';
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_failed_print"
  CHECK (("kind" = 'FAILED_PRINT') = ("printJobId" IS NOT NULL));

-- Append-only: a mistake is corrected by a new movement, never by editing one.
CREATE FUNCTION refuse_stock_movement_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock movements are append-only';
END;
$$;
CREATE TRIGGER "stock_movements_append_only"
BEFORE UPDATE OR DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION refuse_stock_movement_change();

-- materials."stockGrams" is the material's total, recomputed from its movements on each one
-- (never below 0: the shop's estimates can run ahead of what was weighed).
CREATE FUNCTION apply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  material uuid;
BEGIN
  SELECT "materialId" INTO material FROM "stock_items" WHERE "id" = NEW."stockItemId";
  -- One movement of a material at a time: the sum below then counts every committed one.
  PERFORM pg_advisory_xact_lock(hashtext('stock:' || material::text));
  UPDATE "materials" SET "stockGrams" = GREATEST((
    SELECT coalesce(sum(m."grams"), 0)
    FROM "stock_movements" m
    JOIN "stock_items" i ON i."id" = m."stockItemId"
    WHERE i."materialId" = material
  ), 0)
  WHERE "id" = material;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "stock_movements_apply"
AFTER INSERT ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- What each material has today becomes its opening stock (colour not known: "").
INSERT INTO "stock_items" ("id", "materialId", "colour", "lowStockGrams", "updatedAt")
SELECT gen_random_uuid(), "id", '', "lowStockThresholdGrams", CURRENT_TIMESTAMP
FROM "materials";
INSERT INTO "stock_movements" ("id", "stockItemId", "kind", "grams", "note")
SELECT gen_random_uuid(), i."id", 'OPENING', m."stockGrams", 'Stock when tracking started'
FROM "stock_items" i JOIN "materials" m ON m."id" = i."materialId"
WHERE m."stockGrams" > 0;

-- Staff receive deliveries and correct counts (DEFAULT_ROLE_PERMISSIONS in @forgea/types).
UPDATE "role_permissions"
SET "permissions" = array_append("permissions", 'stock.manage')
WHERE "role" = 'STAFF' AND NOT ('stock.manage' = ANY ("permissions"));
