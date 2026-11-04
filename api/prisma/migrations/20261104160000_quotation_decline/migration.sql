-- A customer can decline a quotation; its lead then waits for the team's decision.
ALTER TYPE "QuotationStatus" ADD VALUE 'DECLINED';

ALTER TABLE "lead_stages" ADD COLUMN "isQuoted" BOOLEAN NOT NULL DEFAULT false;
-- The pipeline's own "Quoted" stage, when the owner kept it.
UPDATE "lead_stages" SET "isQuoted" = true WHERE "name" = 'Quoted';

ALTER TABLE "leads" ADD COLUMN "decisionNeeded" TEXT;
