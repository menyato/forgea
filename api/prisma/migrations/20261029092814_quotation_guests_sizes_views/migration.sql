-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "openedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "quotation_lines" ADD COLUMN     "sizeXcm" DECIMAL(7,1),
ADD COLUMN     "sizeYcm" DECIMAL(7,1),
ADD COLUMN     "sizeZcm" DECIMAL(7,1);

-- AlterTable
-- Hand-written: existing quotations take their customer's address before it is required.
ALTER TABLE "quotations" ADD COLUMN "customerEmail" TEXT,
ALTER COLUMN "customerId" DROP NOT NULL;
UPDATE "quotations" q SET "customerEmail" = u."email" FROM "users" u WHERE u."id" = q."customerId";
ALTER TABLE "quotations" ALTER COLUMN "customerEmail" SET NOT NULL;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_email_lowercase"
  CHECK ("customerEmail" = lower("customerEmail") AND "customerEmail" LIKE '%@%');

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "quotationEmailClosing" TEXT,
ADD COLUMN     "quotationEmailIntro" TEXT,
ADD COLUMN     "quotationEmailSubject" TEXT;

-- CreateIndex
CREATE INDEX "quotations_customerEmail_idx" ON "quotations"("customerEmail");

-- Hand-written: a size is all three measures or none, each above zero.
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_size"
  CHECK (("sizeXcm" IS NULL AND "sizeYcm" IS NULL AND "sizeZcm" IS NULL)
      OR ("sizeXcm" > 0 AND "sizeYcm" > 0 AND "sizeZcm" > 0));

-- Leads already in the pipeline count as seen; only new ones show as "New".
UPDATE "leads" SET "openedAt" = "createdAt";
