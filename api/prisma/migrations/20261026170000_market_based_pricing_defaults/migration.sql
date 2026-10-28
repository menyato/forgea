-- Market-based defaults (research of 2026-10-26, see docs/PRICING.md).
-- Data only, no schema change. Each UPDATE matches the previous placeholder value, so it
-- never overwrites a number an admin has already changed in the dashboard.

-- Machine time: printer depreciation (~QAR 1.5/h), maintenance (~QAR 0.4/h), power and
-- overhead for a small studio → QAR 6/h.
UPDATE "pricing_settings" SET "machineRatePerHour" = 6.00, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1 AND "machineRatePerHour" = 10.00;

-- Failed-print buffer: guides put experienced print farms at 5–10%; 8% sits in the middle.
UPDATE "pricing_settings" SET "failureAllowancePercent" = 8.00, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1 AND "failureAllowancePercent" = 10.00;

-- Kept: purge waste 5%, labor QAR 5/unit, packaging QAR 3/unit, markup ×1.6, rush 30%,
-- deposit 50%, delivery QAR 25 (Qatar Post flat last-mile rate, inside and outside Doha).

-- Materials at Qatar retail cost per gram (1 kg spools, mid-range brands).
INSERT INTO "materials" ("id", "code", "name", "pricePerGram", "stockGrams", "lowStockThresholdGrams", "active", "updatedAt") VALUES
  (gen_random_uuid(), 'PLA',  'PLA',  0.1000, 0, 1000, true, CURRENT_TIMESTAMP),  -- QAR 85–122/kg
  (gen_random_uuid(), 'PETG', 'PETG', 0.1100, 0, 1000, true, CURRENT_TIMESTAMP),  -- QAR 85–177/kg
  (gen_random_uuid(), 'ASA',  'ASA',  0.1200, 0, 1000, true, CURRENT_TIMESTAMP)   -- ~QAR 115/kg
ON CONFLICT ("code") DO NOTHING;
