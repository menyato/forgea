-- AlterTable
ALTER TABLE "customer_logos" ADD COLUMN     "inks" JSONB;

-- AlterTable
ALTER TABLE "logos" ADD COLUMN     "inks" JSONB;

-- A logo's colours, when it has them: two or more areas (one colour is the outline alone).
ALTER TABLE "logos" ADD CONSTRAINT "logos_inks_check"
  CHECK ("inks" IS NULL OR (jsonb_typeof("inks") = 'array' AND jsonb_array_length("inks") >= 2));
ALTER TABLE "customer_logos" ADD CONSTRAINT "customer_logos_inks_check"
  CHECK ("inks" IS NULL OR (jsonb_typeof("inks") = 'array' AND jsonb_array_length("inks") >= 2));
