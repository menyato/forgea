-- AlterTable
ALTER TABLE "products" ADD COLUMN     "textSample" VARCHAR(40);

-- Hand-written: an example name belongs to a personalised product only.
ALTER TABLE "products" ADD CONSTRAINT "products_text_sample" CHECK ("textSample" IS NULL OR "textStyle" IS NOT NULL);
