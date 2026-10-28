-- CreateEnum
CREATE TYPE "CustomRequestStatus" AS ENUM ('SUBMITTED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "UploadPurpose" ADD VALUE 'CUSTOM_REQUEST_FILE';

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "customUploadMaxMb" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "depositRefundable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "estimateSolidityPercent" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "estimateSpreadPercent" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "quoteValidityDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabledAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "custom_requests" (
    "id" UUID NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "status" "CustomRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "materialId" UUID,
    "colour" TEXT,
    "fileKey" TEXT,
    "estimateLow" DECIMAL(12,2),
    "estimateHigh" DECIMAL(12,2),
    "quotedPrice" DECIMAL(12,2),
    "quoteNote" TEXT,
    "quotedAt" TIMESTAMPTZ(3),
    "quoteExpiresAt" TIMESTAMPTZ(3),
    "quotedByUserId" UUID,
    "orderId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_request_status_history" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "status" "CustomRequestStatus" NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" UUID,
    "note" TEXT,

    CONSTRAINT "custom_request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_theme" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "palette" JSONB NOT NULL,
    "basedOn" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "site_theme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_requests_requestNumber_key" ON "custom_requests"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "custom_requests_orderId_key" ON "custom_requests"("orderId");

-- CreateIndex
CREATE INDEX "custom_requests_userId_id_idx" ON "custom_requests"("userId", "id");

-- CreateIndex
CREATE INDEX "custom_requests_status_id_idx" ON "custom_requests"("status", "id");

-- CreateIndex
CREATE INDEX "custom_request_status_history_requestId_changedAt_idx" ON "custom_request_status_history"("requestId", "changedAt");

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_quotedByUserId_fkey" FOREIGN KEY ("quotedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_status_history" ADD CONSTRAINT "custom_request_status_history_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "custom_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_request_status_history" ADD CONSTRAINT "custom_request_status_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_theme" ADD CONSTRAINT "site_theme_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Hand-written constraints and triggers.
-- ---------------------------------------------------------------------------

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_custom_requests_check" CHECK (
  "quoteValidityDays" BETWEEN 1 AND 90
  AND "customUploadMaxMb" BETWEEN 1 AND 100
  AND "estimateSolidityPercent" BETWEEN 5 AND 100
  AND "estimateSpreadPercent" BETWEEN 0 AND 100
);

ALTER TABLE "site_theme" ADD CONSTRAINT "site_theme_singleton_check" CHECK ("id" = 1);
ALTER TABLE "site_theme" ADD CONSTRAINT "site_theme_palette_check" CHECK (jsonb_typeof("palette") = 'object');

ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_number_check" CHECK ("requestNumber" ~ '^CR-[0-9A-HJKMNP-TV-Z]{10}$');
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_quantity_check" CHECK ("quantity" BETWEEN 1 AND 1000);
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_estimate_check" CHECK (
  ("estimateLow" IS NULL) = ("estimateHigh" IS NULL)
  AND ("estimateLow" IS NULL OR (0 <= "estimateLow" AND "estimateLow" <= "estimateHigh"))
);
-- A quote is all or nothing: price, time sent, expiry and who sent it.
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_quote_check" CHECK (
  ("quotedPrice" IS NULL) = ("quotedAt" IS NULL)
  AND ("quotedPrice" IS NULL) = ("quoteExpiresAt" IS NULL)
  AND ("quotedPrice" IS NULL OR ("quotedPrice" > 0 AND "quoteExpiresAt" > "quotedAt"))
);
-- Quoted and accepted requests have a quote; accepted ones have their order.
ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_status_check" CHECK (
  ("status" NOT IN ('QUOTED', 'ACCEPTED') OR "quotedPrice" IS NOT NULL)
  AND (("status" = 'ACCEPTED') = ("orderId" IS NOT NULL))
);

-- Same mechanism as orders (migration 20261026200000): every status change writes a history
-- row, with the actor and note from the transaction-scoped settings forgea.actor_id and
-- forgea.status_note.
CREATE FUNCTION record_custom_request_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "custom_request_status_history" ("id", "requestId", "status", "changedAt", "changedByUserId", "note")
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

CREATE TRIGGER "custom_requests_status_history_on_insert"
AFTER INSERT ON "custom_requests"
FOR EACH ROW EXECUTE FUNCTION record_custom_request_status_change();

CREATE TRIGGER "custom_requests_status_history_on_update"
AFTER UPDATE OF "status" ON "custom_requests"
FOR EACH ROW EXECUTE FUNCTION record_custom_request_status_change();

CREATE FUNCTION refuse_custom_request_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'custom_request_status_history is append-only';
END;
$$;

CREATE TRIGGER "custom_request_status_history_append_only"
BEFORE UPDATE ON "custom_request_status_history"
FOR EACH ROW EXECUTE FUNCTION refuse_custom_request_history_change();
