-- The balance check read "entryId" from NEW also when fired on journal_entries, which has no
-- such column (PL/pgSQL resolves both branches of the expression). One branch per table now.
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_id uuid;
  posted boolean;
  debits numeric;
  credits numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    entry_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    entry_id := OLD."entryId";
  ELSE
    entry_id := NEW."entryId";
  END IF;
  SELECT "state" = 'POSTED' INTO posted FROM "journal_entries" WHERE "id" = entry_id;
  IF posted THEN
    SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0) INTO debits, credits
    FROM "journal_lines" WHERE "entryId" = entry_id;
    IF debits <> credits OR debits = 0 THEN
      RAISE EXCEPTION 'journal entry % does not balance (debit %, credit %)', entry_id, debits, credits;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Same for lines of a posted entry (OLD for deletions, NEW otherwise).
CREATE OR REPLACE FUNCTION refuse_posted_line_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entry_id := OLD."entryId";
  ELSE
    entry_id := NEW."entryId";
  END IF;
  IF EXISTS (SELECT 1 FROM "journal_entries" WHERE "id" = entry_id AND "state" = 'POSTED') THEN
    RAISE EXCEPTION 'lines of a posted journal entry cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
