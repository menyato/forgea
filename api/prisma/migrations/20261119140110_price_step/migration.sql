-- AlterTable
ALTER TABLE "pricing_settings" ADD COLUMN     "priceStep" DECIMAL(10,2) NOT NULL DEFAULT 1;

-- Hand-written: a step of at least a cent (the engine checks it too).
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_priceStep_cent"
  CHECK ("priceStep" >= 0.01);
