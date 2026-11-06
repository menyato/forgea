-- What came out of the printer, reprints, and the pieces printed but not sold yet.
ALTER TABLE "print_jobs"
  ADD COLUMN "goodPieces" INTEGER,
  ADD COLUMN "sparePieces" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "replacesJobId" UUID;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_replacesJobId_fkey"
  FOREIGN KEY ("replacesJobId") REFERENCES "print_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "print_jobs_replacesJobId_idx" ON "print_jobs"("replacesJobId");
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_pieces_check" CHECK (
  ("goodPieces" IS NULL OR "goodPieces" BETWEEN 0 AND "quantity")
  AND "sparePieces" >= 0
  AND ("status" = 'DONE' OR ("goodPieces" IS NULL AND "sparePieces" = 0))
  AND ("note" IS NULL OR char_length("note") <= 500)
);

CREATE TYPE "ReadyPieceMovementKind" AS ENUM ('PRINTED', 'LEFT_OVER', 'ADDED', 'SOLD', 'USED', 'SCRAPPED', 'COUNTED');

CREATE TABLE "ready_pieces" (
    "id" UUID NOT NULL,
    "productId" UUID,
    "name" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ready_pieces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ready_pieces_on_hand_check" CHECK ("onHand" >= 0 AND "unitCost" >= 0),
    CONSTRAINT "ready_pieces_name_check" CHECK (char_length("name") BETWEEN 1 AND 200 AND char_length("details") <= 300)
);
-- One row per kind of piece; a custom design (no product) counts as one too.
CREATE UNIQUE INDEX "ready_pieces_productId_name_details_key"
  ON "ready_pieces"("productId", "name", "details") NULLS NOT DISTINCT;
ALTER TABLE "ready_pieces" ADD CONSTRAINT "ready_pieces_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ready_piece_movements" (
    "id" UUID NOT NULL,
    "readyPieceId" UUID NOT NULL,
    "kind" "ReadyPieceMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(10,2) NOT NULL,
    "printJobId" UUID,
    "orderId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ready_piece_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ready_piece_movements_direction" CHECK (
      ("kind" IN ('PRINTED', 'LEFT_OVER', 'ADDED') AND "quantity" > 0)
      OR ("kind" IN ('SOLD', 'USED', 'SCRAPPED') AND "quantity" < 0)
      OR ("kind" = 'COUNTED' AND "quantity" <> 0)
    ),
    CONSTRAINT "ready_piece_movements_cost_check" CHECK ("unitCost" >= 0),
    CONSTRAINT "ready_piece_movements_note_check" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
CREATE INDEX "ready_piece_movements_readyPieceId_createdAt_idx" ON "ready_piece_movements"("readyPieceId", "createdAt");
CREATE INDEX "ready_piece_movements_createdAt_idx" ON "ready_piece_movements"("createdAt");
ALTER TABLE "ready_piece_movements" ADD CONSTRAINT "ready_piece_movements_readyPieceId_fkey"
  FOREIGN KEY ("readyPieceId") REFERENCES "ready_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ready_piece_movements" ADD CONSTRAINT "ready_piece_movements_printJobId_fkey"
  FOREIGN KEY ("printJobId") REFERENCES "print_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ready_piece_movements" ADD CONSTRAINT "ready_piece_movements_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ready_piece_movements" ADD CONSTRAINT "ready_piece_movements_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A job's spare or left-over pieces go to the shelf once (a double click can't add them twice).
CREATE UNIQUE INDEX "ready_piece_movements_job_once"
  ON "ready_piece_movements"("printJobId", "kind") WHERE "printJobId" IS NOT NULL;

-- The history is never rewritten.
CREATE FUNCTION refuse_ready_piece_movement_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ready piece movements are append-only';
END;
$$;
CREATE TRIGGER "ready_piece_movements_append_only"
BEFORE UPDATE OR DELETE ON "ready_piece_movements"
FOR EACH ROW EXECUTE FUNCTION refuse_ready_piece_movement_change();

-- The shelf follows its movements in the same statement: the count (never below 0, so two
-- people taking the last piece can't both succeed) and the average cost of what came in.
CREATE FUNCTION apply_ready_piece_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "ready_pieces" SET
    "unitCost" = CASE
      WHEN NEW."quantity" > 0 AND NEW."kind" <> 'COUNTED' THEN
        round(("onHand" * "unitCost" + NEW."quantity" * NEW."unitCost") / ("onHand" + NEW."quantity"), 2)
      ELSE "unitCost" END,
    "onHand" = "onHand" + NEW."quantity",
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = NEW."readyPieceId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ready_piece_movements_apply"
AFTER INSERT ON "ready_piece_movements"
FOR EACH ROW EXECUTE FUNCTION apply_ready_piece_movement();
