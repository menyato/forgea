-- Hand-written: an admin may remove a test order entirely (its invoices, credit notes, payments,
-- stock and print records). Every guard below still refuses a delete, except inside the one
-- transaction OrderRemoval marks with `set_config('forgea.removing', 'test-order', true)`.

CREATE OR REPLACE FUNCTION refuse_order_status_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'changedByUserId') = (to_jsonb(OLD) - 'changedByUserId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_status_history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION refuse_posted_entry_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  IF OLD."state" = 'POSTED' THEN
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'customerId') = (to_jsonb(OLD) - 'customerId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'journal entry % is posted and cannot be changed', OLD."id";
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION refuse_posted_line_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."entryId" <> OLD."entryId" THEN
    RAISE EXCEPTION 'a journal line cannot be moved to another entry';
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'customerId') = (to_jsonb(OLD) - 'customerId') THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM "journal_entries" WHERE "id" = OLD."entryId" AND "state" = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'lines of a posted journal entry cannot be changed';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1 FROM "journal_entries" WHERE "id" = NEW."entryId" AND "state" = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'lines of a posted journal entry cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION check_reconciliation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debit_amount numeric;
  credit_amount numeric;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'reconciliations cannot be changed or removed';
  END IF;
  SELECT "debit" INTO debit_amount FROM "journal_lines" WHERE "id" = NEW."debitLineId" FOR UPDATE;
  SELECT "credit" INTO credit_amount FROM "journal_lines" WHERE "id" = NEW."creditLineId" FOR UPDATE;
  IF NEW."amount" + COALESCE((SELECT SUM("amount") FROM "reconciliations"
                              WHERE "debitLineId" = NEW."debitLineId"), 0) > debit_amount THEN
    RAISE EXCEPTION 'this would match more than the invoice line owes';
  END IF;
  IF NEW."amount" + COALESCE((SELECT SUM("amount") FROM "reconciliations"
                              WHERE "creditLineId" = NEW."creditLineId"), 0) > credit_amount THEN
    RAISE EXCEPTION 'this would match more than the payment line holds';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refuse_stock_movement_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forgea.removing', true) = 'test-order' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'stock movements are append-only';
END;
$$;
