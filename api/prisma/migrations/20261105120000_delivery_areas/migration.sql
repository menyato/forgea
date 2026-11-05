-- Delivery is to a chosen area, never free text: Lebanon's 26 districts to start with.
ALTER TABLE "store_settings" ADD COLUMN "deliveryAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "store_settings" SET "deliveryAreas" = ARRAY['Beirut', 'Akkar', 'Aley', 'Baabda', 'Baalbek', 'Batroun', 'Bint Jbeil', 'Bsharri', 'Chouf', 'Hasbaya', 'Hermel', 'Jbeil', 'Jezzine', 'Keserwan', 'Koura', 'Marjayoun', 'Matn', 'Miniyeh-Danniyeh', 'Nabatieh', 'Rashaya', 'Saida', 'Tripoli', 'Tyre', 'West Bekaa', 'Zahle', 'Zgharta'];
