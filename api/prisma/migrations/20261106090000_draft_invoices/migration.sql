-- Invoices may wait as drafts (no number, outside the books). Only posted entries are ever
-- matched with each other: a payment can never settle a draft.
CREATE FUNCTION check_reconciliation_posted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "journal_lines" l
    JOIN "journal_entries" e ON e."id" = l."entryId"
    WHERE l."id" IN (NEW."debitLineId", NEW."creditLineId") AND e."state" <> 'POSTED'
  ) THEN
    RAISE EXCEPTION 'only posted entries are matched';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "reconciliations_posted_only"
BEFORE INSERT ON "reconciliations"
FOR EACH ROW EXECUTE FUNCTION check_reconciliation_posted();

-- A posted entry always has its number; a draft never has one.
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_number_check"
  CHECK (("state" = 'POSTED') = ("number" IS NOT NULL));
