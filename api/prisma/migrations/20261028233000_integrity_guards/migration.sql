-- The database itself refuses what the code must never do (security review, 2026-10-28):
-- history rows are never deleted, payments never match more than an invoice owes, and the
-- lines of a posted entry can't be moved out of it.

-- 1. Status histories are append-only: no UPDATE (already refused) and now no DELETE either.
CREATE TRIGGER "order_status_history_no_delete"
BEFORE DELETE ON "order_status_history"
FOR EACH ROW EXECUTE FUNCTION refuse_order_status_history_change();

CREATE TRIGGER "custom_request_status_history_no_delete"
BEFORE DELETE ON "custom_request_status_history"
FOR EACH ROW EXECUTE FUNCTION refuse_custom_request_history_change();

CREATE TRIGGER "quotation_status_history_no_delete"
BEFORE DELETE ON "quotation_status_history"
FOR EACH ROW EXECUTE FUNCTION refuse_quotation_history_change();

-- 2. A matching (payment or credit note ↔ invoice) is never edited or removed, and the matches
--    on a line never add up to more than the line's amount. The lines are locked while
--    checking, so two matches at once can't both slip under the limit.
CREATE FUNCTION check_reconciliation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debit_amount numeric;
  credit_amount numeric;
BEGIN
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

CREATE TRIGGER "reconciliations_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "reconciliations"
FOR EACH ROW EXECUTE FUNCTION check_reconciliation();

-- 3. A line of a posted entry can't be changed, deleted or moved to another entry: the old
--    entry is checked as well as the new one, and changing a line's entry is refused outright.
CREATE OR REPLACE FUNCTION refuse_posted_line_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."entryId" <> OLD."entryId" THEN
    RAISE EXCEPTION 'a journal line cannot be moved to another entry';
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
