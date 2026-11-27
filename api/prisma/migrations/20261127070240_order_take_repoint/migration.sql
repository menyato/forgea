-- An order line's take of filament made again from the reels the team picked for its colours
-- (OrderFilamentsService, which marks its transaction with
-- `set_config('forgea.repointing', 'order-filaments', true)`): there, and only there, that line's
-- own ORDER movements may be removed (its new takes are then added as usual). A filament the
-- shop once took from by mistake is left with nothing and can be deleted. Anything else stays
-- append-only.
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
  RAISE EXCEPTION 'stock movements are append-only';
END;
$$;

-- A removed take gives its grams back to its material's total (counted again, as on insert).
CREATE FUNCTION unapply_stock_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  material uuid;
BEGIN
  SELECT "materialId" INTO material FROM "stock_items" WHERE "id" = OLD."stockItemId";
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
CREATE TRIGGER "stock_movements_unapply"
AFTER DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION unapply_stock_movement();
