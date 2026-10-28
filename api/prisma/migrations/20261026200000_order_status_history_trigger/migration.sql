-- Every order status change writes an OrderStatusHistory row — enforced here, in the
-- database, so no code path (or manual SQL) can change a status without leaving a record.
--
-- The application says who made the change and why with transaction-scoped settings:
--   SELECT set_config('forgea.actor_id', '<user uuid>', true);
--   SELECT set_config('forgea.status_note', '<note>', true);
-- Unset → NULL (a system change, e.g. a guest placing an order).

CREATE FUNCTION record_order_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "order_status_history" ("id", "orderId", "status", "changedAt", "changedByUserId", "note")
    VALUES (
      gen_random_uuid(),
      NEW."id",
      NEW."status",
      CURRENT_TIMESTAMP,
      NULLIF(current_setting('forgea.actor_id', true), '')::uuid,
      NULLIF(current_setting('forgea.status_note', true), '')
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_status_history_on_insert"
AFTER INSERT ON "orders"
FOR EACH ROW EXECUTE FUNCTION record_order_status_change();

CREATE TRIGGER "orders_status_history_on_update"
AFTER UPDATE OF "status" ON "orders"
FOR EACH ROW EXECUTE FUNCTION record_order_status_change();

-- History is append-only.
CREATE FUNCTION refuse_order_status_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_status_history is append-only';
END;
$$;

CREATE TRIGGER "order_status_history_append_only"
BEFORE UPDATE ON "order_status_history"
FOR EACH ROW EXECUTE FUNCTION refuse_order_status_history_change();
