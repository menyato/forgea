-- Merging one customer into another (Dashboard → Customers → Merge) re-points everything the
-- first one has to the second, then removes the first. History stays final in what it says:
-- the only change a posted journal entry, its lines or a status history row accept is who it
-- points at (the customer on an entry or a line, who made a status change). Amounts, accounts,
-- states, dates and statuses still can't change, and nothing can be deleted.

-- Posted entries: only "customerId" may change.
CREATE OR REPLACE FUNCTION refuse_posted_entry_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
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

-- Lines of a posted entry: only "customerId" may change; never moved, added or deleted.
CREATE OR REPLACE FUNCTION refuse_posted_line_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
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

-- Status histories stay append-only; only who made a change may be re-pointed.
CREATE OR REPLACE FUNCTION refuse_order_status_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'changedByUserId') = (to_jsonb(OLD) - 'changedByUserId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_status_history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION refuse_custom_request_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'changedByUserId') = (to_jsonb(OLD) - 'changedByUserId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'custom_request_status_history is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION refuse_quotation_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'changedByUserId') = (to_jsonb(OLD) - 'changedByUserId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'quotation_status_history is append-only';
END;
$$;
