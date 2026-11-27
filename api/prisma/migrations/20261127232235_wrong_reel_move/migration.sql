-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "movedAt" TIMESTAMPTZ(3),
ADD COLUMN     "movedById" UUID,
ADD COLUMN     "movedFromId" UUID;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_movedFromId_fkey" FOREIGN KEY ("movedFromId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Moved together: the filament it was first on (never the one it is on now), when, by whom.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_moved" CHECK (
  ("movedFromId" IS NULL) = ("movedAt" IS NULL)
  AND ("movedFromId" IS NULL OR "movedFromId" <> "stockItemId")
);

-- Append-only, with two marked exceptions. A take recorded on the wrong filament is moved to the
-- right one by StockService.move, which marks its transaction with
-- `set_config('forgea.repointing', 'wrong-reel', true)`: only which filament it is on, its cost
-- per gram and who moved it when may change, never its grams, kind or what it was for.
CREATE OR REPLACE FUNCTION refuse_stock_movement_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE'
    AND current_setting('forgea.repointing', true) = 'order-filaments'
    AND OLD."kind" = 'ORDER'
    AND OLD."orderItemId" IS NOT NULL THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
    AND current_setting('forgea.repointing', true) = 'wrong-reel'
    AND to_jsonb(NEW) - ARRAY['stockItemId', 'costPerGram', 'movedFromId', 'movedAt', 'movedById']
      = to_jsonb(OLD) - ARRAY['stockItemId', 'costPerGram', 'movedFromId', 'movedAt', 'movedById']
    AND NEW."movedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stock movements are append-only';
END;
$$;

-- A moved take counts on its new material and leaves the old one (both totals counted again).
CREATE FUNCTION reapply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  material uuid;
BEGIN
  FOR material IN
    SELECT DISTINCT "materialId" FROM "stock_items"
    WHERE "id" IN (OLD."stockItemId", NEW."stockItemId")
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('stock:' || material::text));
    UPDATE "materials" SET "stockGrams" = GREATEST((
      SELECT coalesce(sum(m."grams"), 0)
      FROM "stock_movements" m
      JOIN "stock_items" i ON i."id" = m."stockItemId"
      WHERE i."materialId" = material
    ), 0)
    WHERE "id" = material;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "stock_movements_reapply"
AFTER UPDATE OF "stockItemId" ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION reapply_stock_movement();
