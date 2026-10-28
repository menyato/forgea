-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('RECEIVABLE', 'PAYABLE', 'CASH', 'BANK', 'CURRENT_ASSET', 'FIXED_ASSET', 'CURRENT_LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('SALE', 'CASH', 'BANK', 'GENERAL');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('ENTRY', 'INVOICE', 'CREDIT_NOTE', 'PAYMENT');

-- CreateEnum
CREATE TYPE "EntryState" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('DEPOSIT', 'FINAL');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('FORM', 'CUSTOM_REQUEST', 'MANUAL');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TODO');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'CANCELLED');



-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "JournalType" NOT NULL,
    "defaultAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "accountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "number" TEXT,
    "type" "EntryType" NOT NULL,
    "state" "EntryState" NOT NULL DEFAULT 'DRAFT',
    "journalId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "customerId" UUID,
    "orderId" UUID,
    "invoiceKind" "InvoiceKind",
    "label" TEXT NOT NULL,
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(20,8) NOT NULL DEFAULT 1,
    "reversedEntryId" UUID,
    "postedAt" TIMESTAMPTZ(3),
    "postedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "customerId" UUID,
    "label" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountCurrency" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "taxId" UUID,
    "dueDate" DATE,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "debitLineId" UUID NOT NULL,
    "creditLineId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_sequences" (
    "journalId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "series" TEXT NOT NULL DEFAULT '',
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "entry_sequences_pkey" PRIMARY KEY ("journalId","year","series")
);

-- CreateTable
CREATE TABLE "accounting_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "receivableAccountId" UUID NOT NULL,
    "productIncomeAccountId" UUID NOT NULL,
    "customIncomeAccountId" UUID NOT NULL,
    "deliveryAccountId" UUID NOT NULL,
    "rushAccountId" UUID NOT NULL,
    "depositAccountId" UUID NOT NULL,
    "saleJournalId" UUID NOT NULL,
    "cashJournalId" UUID NOT NULL,
    "bankJournalId" UUID NOT NULL,
    "generalJournalId" UUID NOT NULL,
    "salesTaxId" UUID,
    "lockDate" DATE,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "defaultProbability" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_reasons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "assignedToId" UUID,
    "doneAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "customerId" UUID NOT NULL,
    "leadId" UUID,
    "validUntil" DATE NOT NULL,
    "note" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "delivery" BOOLEAN NOT NULL DEFAULT false,
    "city" TEXT,
    "addressLine" TEXT,
    "total" DECIMAL(12,2) NOT NULL,
    "orderId" UUID,
    "createdById" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_lines" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_status_history" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "status" "QuotationStatus" NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" UUID,
    "note" TEXT,

    CONSTRAINT "quotation_status_history_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Leads move from a fixed status to owner-editable stages (Odoo-style pipeline).
-- ---------------------------------------------------------------------------

INSERT INTO "lead_stages" ("id", "name", "sortOrder", "isWon", "defaultProbability", "updatedAt") VALUES
  (gen_random_uuid(), 'New', 1, false, 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Contacted', 2, false, 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Quoted', 3, false, 60, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Won', 4, true, 100, CURRENT_TIMESTAMP);
INSERT INTO "lost_reasons" ("id", "name") VALUES
  (gen_random_uuid(), 'Too expensive'),
  (gen_random_uuid(), 'Went elsewhere'),
  (gen_random_uuid(), 'Not something we make'),
  (gen_random_uuid(), 'No reply');

DROP INDEX "leads_status_id_idx";
ALTER TABLE "leads"
ADD COLUMN     "assignedToId" UUID,
ADD COLUMN     "closedAt" TIMESTAMPTZ(3),
ADD COLUMN     "customRequestId" UUID,
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "deadline" DATE,
ADD COLUMN     "expectedRevenue" DECIMAL(12,2),
ADD COLUMN     "lostReasonId" UUID,
ADD COLUMN     "probability" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "source" "LeadSource" NOT NULL DEFAULT 'FORM',
ADD COLUMN     "stageChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "stageId" UUID;

-- Each lead keeps its place: NEW/CONTACTED/QUOTED → that stage, WON → Won, LOST → closed.
UPDATE "leads" l SET
  "stageId" = s."id",
  "probability" = CASE l."status" WHEN 'WON' THEN 100 WHEN 'LOST' THEN 0 ELSE s."defaultProbability" END,
  "closedAt" = CASE WHEN l."status" IN ('WON', 'LOST') THEN l."updatedAt" END
FROM "lead_stages" s
WHERE s."name" = CASE l."status"
  WHEN 'NEW' THEN 'New' WHEN 'CONTACTED' THEN 'Contacted' WHEN 'QUOTED' THEN 'Quoted'
  WHEN 'WON' THEN 'Won' ELSE 'New' END;

ALTER TABLE "leads" ALTER COLUMN "stageId" SET NOT NULL, DROP COLUMN "status";
DROP TYPE "LeadStatus";

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journals_code_key" ON "journals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "taxes_name_key" ON "taxes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_number_key" ON "journal_entries"("number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversedEntryId_key" ON "journal_entries"("reversedEntryId");

-- CreateIndex
CREATE INDEX "journal_entries_journalId_date_idx" ON "journal_entries"("journalId", "date");

-- CreateIndex
CREATE INDEX "journal_entries_customerId_idx" ON "journal_entries"("customerId");

-- CreateIndex
CREATE INDEX "journal_entries_orderId_idx" ON "journal_entries"("orderId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE INDEX "journal_lines_accountId_idx" ON "journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "journal_lines_customerId_idx" ON "journal_lines"("customerId");

-- CreateIndex
CREATE INDEX "reconciliations_debitLineId_idx" ON "reconciliations"("debitLineId");

-- CreateIndex
CREATE INDEX "reconciliations_creditLineId_idx" ON "reconciliations"("creditLineId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_stages_name_key" ON "lead_stages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "lost_reasons_name_key" ON "lost_reasons"("name");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_dueAt_idx" ON "lead_activities"("leadId", "dueAt");

-- CreateIndex
CREATE INDEX "lead_activities_doneAt_dueAt_idx" ON "lead_activities"("doneAt", "dueAt");

-- CreateIndex
CREATE INDEX "lead_notes_leadId_createdAt_idx" ON "lead_notes"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_number_key" ON "quotations"("number");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_orderId_key" ON "quotations"("orderId");

-- CreateIndex
CREATE INDEX "quotations_status_id_idx" ON "quotations"("status", "id");

-- CreateIndex
CREATE INDEX "quotations_customerId_idx" ON "quotations"("customerId");

-- CreateIndex
CREATE INDEX "quotation_lines_quotationId_idx" ON "quotation_lines"("quotationId");

-- CreateIndex
CREATE INDEX "quotation_status_history_quotationId_changedAt_idx" ON "quotation_status_history"("quotationId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "leads_customRequestId_key" ON "leads"("customRequestId");

-- CreateIndex
CREATE INDEX "leads_stageId_id_idx" ON "leads"("stageId", "id");

-- CreateIndex
CREATE INDEX "leads_closedAt_idx" ON "leads"("closedAt");


-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversedEntryId_fkey" FOREIGN KEY ("reversedEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_taxId_fkey" FOREIGN KEY ("taxId") REFERENCES "taxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_debitLineId_fkey" FOREIGN KEY ("debitLineId") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_creditLineId_fkey" FOREIGN KEY ("creditLineId") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_sequences" ADD CONSTRAINT "entry_sequences_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_receivableAccountId_fkey" FOREIGN KEY ("receivableAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_productIncomeAccountId_fkey" FOREIGN KEY ("productIncomeAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_customIncomeAccountId_fkey" FOREIGN KEY ("customIncomeAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_deliveryAccountId_fkey" FOREIGN KEY ("deliveryAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_rushAccountId_fkey" FOREIGN KEY ("rushAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_depositAccountId_fkey" FOREIGN KEY ("depositAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_saleJournalId_fkey" FOREIGN KEY ("saleJournalId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_cashJournalId_fkey" FOREIGN KEY ("cashJournalId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_bankJournalId_fkey" FOREIGN KEY ("bankJournalId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_generalJournalId_fkey" FOREIGN KEY ("generalJournalId") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_salesTaxId_fkey" FOREIGN KEY ("salesTaxId") REFERENCES "taxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "lead_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customRequestId_fkey" FOREIGN KEY ("customRequestId") REFERENCES "custom_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_lostReasonId_fkey" FOREIGN KEY ("lostReasonId") REFERENCES "lost_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_status_history" ADD CONSTRAINT "quotation_status_history_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_status_history" ADD CONSTRAINT "quotation_status_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Hand-written constraints, triggers and starting data.
-- ---------------------------------------------------------------------------

ALTER TABLE "lead_stages" ADD CONSTRAINT "lead_stages_probability_check" CHECK ("defaultProbability" BETWEEN 0 AND 100);
ALTER TABLE "leads" ADD CONSTRAINT "leads_probability_check" CHECK ("probability" BETWEEN 0 AND 100);
ALTER TABLE "leads" ADD CONSTRAINT "leads_revenue_check" CHECK ("expectedRevenue" IS NULL OR "expectedRevenue" >= 0);
-- A lost lead is closed; only closed leads have a lost reason.
ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_check" CHECK ("lostReasonId" IS NULL OR "closedAt" IS NOT NULL);

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_number_check" CHECK ("number" ~ '^Q-[0-9]{4}-[0-9]{4,}$');
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_total_check" CHECK ("total" >= 0);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_confirmed_check" CHECK (("status" = 'CONFIRMED') = ("orderId" IS NOT NULL));
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_delivery_check" CHECK (NOT "delivery" OR ("city" IS NOT NULL AND "addressLine" IS NOT NULL));
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_values_check" CHECK (
  "quantity" >= 1 AND "unitPrice" >= 0 AND "discountPercent" BETWEEN 0 AND 100
);

-- Quotation status history: the same mechanism as orders and custom requests.
CREATE FUNCTION record_quotation_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "quotation_status_history" ("id", "quotationId", "status", "changedAt", "changedByUserId", "note")
    VALUES (
      gen_random_uuid(), NEW."id", NEW."status", CURRENT_TIMESTAMP,
      NULLIF(current_setting('forgea.actor_id', true), '')::uuid,
      NULLIF(current_setting('forgea.status_note', true), '')
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "quotations_status_history_on_insert" AFTER INSERT ON "quotations"
FOR EACH ROW EXECUTE FUNCTION record_quotation_status_change();
CREATE TRIGGER "quotations_status_history_on_update" AFTER UPDATE OF "status" ON "quotations"
FOR EACH ROW EXECUTE FUNCTION record_quotation_status_change();
CREATE FUNCTION refuse_quotation_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'quotation_status_history is append-only';
END;
$$;
CREATE TRIGGER "quotation_status_history_append_only" BEFORE UPDATE ON "quotation_status_history"
FOR EACH ROW EXECUTE FUNCTION refuse_quotation_history_change();

-- The ledger --------------------------------------------------------------

ALTER TABLE "taxes" ADD CONSTRAINT "taxes_rate_check" CHECK ("ratePercent" > 0 AND "ratePercent" < 100);
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amounts_check" CHECK (
  "debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0)
);
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_amount_check" CHECK ("amount" > 0);
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_check" CHECK (
  "state" = 'DRAFT' OR ("number" IS NOT NULL AND "postedAt" IS NOT NULL)
);
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_rate_check" CHECK ("exchangeRate" > 0);

-- Every posted entry balances: total debit = total credit, and is not empty. Checked at the
-- end of the transaction, so lines and the entry can be written in any order.
CREATE FUNCTION check_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_id uuid := CASE WHEN TG_TABLE_NAME = 'journal_entries' THEN NEW."id" ELSE COALESCE(NEW."entryId", OLD."entryId") END;
  posted boolean;
  debits numeric;
  credits numeric;
BEGIN
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
CREATE CONSTRAINT TRIGGER "journal_entries_balanced" AFTER INSERT OR UPDATE ON "journal_entries"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- Posted entries are final: no change, no deletion, not even of their lines. Corrections
-- are reversals (a credit note or a reversing entry).
CREATE FUNCTION refuse_posted_entry_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."state" = 'POSTED' THEN
    RAISE EXCEPTION 'journal entry % is posted and cannot be changed', OLD."id";
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "journal_entries_final" BEFORE UPDATE OR DELETE ON "journal_entries"
FOR EACH ROW EXECUTE FUNCTION refuse_posted_entry_change();

CREATE FUNCTION refuse_posted_line_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "journal_entries"
    WHERE "id" = COALESCE(NEW."entryId", OLD."entryId") AND "state" = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'lines of a posted journal entry cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "journal_lines_final" BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
FOR EACH ROW EXECUTE FUNCTION refuse_posted_line_change();

-- A small studio's chart of accounts (editable in the dashboard).
INSERT INTO "accounts" ("id", "code", "name", "type") VALUES
  (gen_random_uuid(), '1000', 'Cash', 'CASH'),
  (gen_random_uuid(), '1010', 'Money transfers (Whish, OMT)', 'BANK'),
  (gen_random_uuid(), '1100', 'Customers (receivable)', 'RECEIVABLE'),
  (gen_random_uuid(), '1200', 'Filament and materials stock', 'CURRENT_ASSET'),
  (gen_random_uuid(), '1500', 'Printers and equipment', 'FIXED_ASSET'),
  (gen_random_uuid(), '2000', 'Suppliers (payable)', 'PAYABLE'),
  (gen_random_uuid(), '2100', 'VAT payable', 'CURRENT_LIABILITY'),
  (gen_random_uuid(), '2200', 'Customer deposits', 'CURRENT_LIABILITY'),
  (gen_random_uuid(), '3000', 'Owner equity', 'EQUITY'),
  (gen_random_uuid(), '3900', 'Retained earnings', 'EQUITY'),
  (gen_random_uuid(), '4000', 'Sales: catalog products', 'INCOME'),
  (gen_random_uuid(), '4100', 'Sales: made-to-order work', 'INCOME'),
  (gen_random_uuid(), '4200', 'Delivery charged', 'INCOME'),
  (gen_random_uuid(), '4300', 'Rush fees', 'INCOME'),
  (gen_random_uuid(), '5000', 'Filament and materials used', 'EXPENSE'),
  (gen_random_uuid(), '5100', 'Electricity and machine costs', 'EXPENSE'),
  (gen_random_uuid(), '5200', 'Packaging', 'EXPENSE'),
  (gen_random_uuid(), '5300', 'Delivery costs', 'EXPENSE'),
  (gen_random_uuid(), '6000', 'Rent', 'EXPENSE'),
  (gen_random_uuid(), '6900', 'Other expenses', 'EXPENSE');

INSERT INTO "journals" ("id", "code", "name", "type", "defaultAccountId") VALUES
  (gen_random_uuid(), 'INV', 'Customer invoices', 'SALE', (SELECT "id" FROM "accounts" WHERE "code" = '4000')),
  (gen_random_uuid(), 'CSH', 'Cash', 'CASH', (SELECT "id" FROM "accounts" WHERE "code" = '1000')),
  (gen_random_uuid(), 'BNK', 'Money transfers', 'BANK', (SELECT "id" FROM "accounts" WHERE "code" = '1010')),
  (gen_random_uuid(), 'MISC', 'General', 'GENERAL', (SELECT "id" FROM "accounts" WHERE "code" = '6900'));

-- Lebanese VAT (11%) exists but is not applied until the owner chooses it in the dashboard.
INSERT INTO "taxes" ("id", "name", "ratePercent", "accountId") VALUES
  (gen_random_uuid(), 'VAT 11%', 11, (SELECT "id" FROM "accounts" WHERE "code" = '2100'));

INSERT INTO "accounting_settings" (
  "id", "receivableAccountId", "productIncomeAccountId", "customIncomeAccountId",
  "deliveryAccountId", "rushAccountId", "depositAccountId",
  "saleJournalId", "cashJournalId", "bankJournalId", "generalJournalId", "updatedAt"
) VALUES (
  1,
  (SELECT "id" FROM "accounts" WHERE "code" = '1100'),
  (SELECT "id" FROM "accounts" WHERE "code" = '4000'),
  (SELECT "id" FROM "accounts" WHERE "code" = '4100'),
  (SELECT "id" FROM "accounts" WHERE "code" = '4200'),
  (SELECT "id" FROM "accounts" WHERE "code" = '4300'),
  (SELECT "id" FROM "accounts" WHERE "code" = '2200'),
  (SELECT "id" FROM "journals" WHERE "code" = 'INV'),
  (SELECT "id" FROM "journals" WHERE "code" = 'CSH'),
  (SELECT "id" FROM "journals" WHERE "code" = 'BNK'),
  (SELECT "id" FROM "journals" WHERE "code" = 'MISC'),
  CURRENT_TIMESTAMP
);
