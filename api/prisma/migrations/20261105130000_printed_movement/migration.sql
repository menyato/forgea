-- A finished print job's stock movement (its difference from the order's estimate).
-- On its own: a new enum value can't be used in the migration that adds it.
ALTER TYPE "StockMovementKind" ADD VALUE 'PRINTED';
