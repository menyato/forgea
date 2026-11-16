-- CreateEnum
CREATE TYPE "PieceStage" AS ENUM ('PRINTING', 'IN_LAB', 'IN_SHOP', 'WITH_SOMEONE', 'GIVEN', 'SOLD', 'FAILED');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "pieceId" UUID;

-- CreateTable
CREATE TABLE "pieces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "productId" UUID,
    "orderItemId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "stage" "PieceStage" NOT NULL,
    "holder" TEXT,
    "note" TEXT,
    "printedAt" TIMESTAMPTZ(3) NOT NULL,
    "grams" INTEGER,
    "cost" DECIMAL(10,2),
    "plan" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_moves" (
    "id" UUID NOT NULL,
    "pieceId" UUID NOT NULL,
    "stage" "PieceStage" NOT NULL,
    "holder" TEXT,
    "note" TEXT,
    "byId" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "piece_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_extra_costs" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_extra_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pieces_orderItemId_key" ON "pieces"("orderItemId");

-- CreateIndex
CREATE INDEX "pieces_printedAt_idx" ON "pieces"("printedAt");

-- CreateIndex
CREATE INDEX "pieces_stage_idx" ON "pieces"("stage");

-- CreateIndex
CREATE INDEX "piece_moves_pieceId_at_idx" ON "piece_moves"("pieceId", "at");

-- CreateIndex
CREATE INDEX "product_extra_costs_productId_idx" ON "product_extra_costs"("productId");

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_moves" ADD CONSTRAINT "piece_moves_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_moves" ADD CONSTRAINT "piece_moves_byId_fkey" FOREIGN KEY ("byId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_extra_costs" ADD CONSTRAINT "product_extra_costs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: what a piece and an extra cost may hold.
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_sane" CHECK (
  "quantity" > 0
  AND char_length(btrim("name")) BETWEEN 1 AND 200
  AND ("grams" IS NULL OR "grams" >= 0)
  AND ("cost" IS NULL OR "cost" >= 0)
  AND ("holder" IS NULL OR char_length("holder") <= 120)
  -- Only a print still on the printer carries what to record when it is done.
  AND (("stage" = 'PRINTING') = ("plan" IS NOT NULL))
);
ALTER TABLE "product_extra_costs" ADD CONSTRAINT "product_extra_costs_sane" CHECK (
  "amount" >= 0 AND char_length(btrim("label")) BETWEEN 1 AND 80
);

-- A piece's moves are its history: never rewritten.
CREATE FUNCTION refuse_piece_move_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'piece moves are append-only';
END;
$$;
CREATE TRIGGER "piece_moves_append_only"
BEFORE UPDATE ON "piece_moves"
FOR EACH ROW EXECUTE FUNCTION refuse_piece_move_change();

-- The board starts with everything already printed.
-- Order lines whose print runs are done: one piece per line, at what the runs really cost;
-- a line of a paid order was sold to its customer.
INSERT INTO "pieces" ("id", "name", "productId", "orderItemId", "quantity", "stage", "holder",
                      "printedAt", "grams", "cost", "updatedAt")
SELECT gen_random_uuid(), left(oi."name", 200), oi."productId", oi."id", oi."quantity",
       CASE WHEN o."total" > 0 THEN 'SOLD'::"PieceStage" ELSE 'IN_LAB'::"PieceStage" END,
       CASE WHEN o."total" > 0 THEN left(coalesce(nullif(btrim(u."name"), ''), u."email"), 120) END,
       max(j."finishedAt"),
       round(sum(coalesce(j."actualGrams", 0)))::int,
       sum(coalesce(j."materialCost", 0) + coalesce(j."electricityCost", 0) + coalesce(j."wearCost", 0)),
       now()
FROM "print_jobs" j
JOIN "order_items" oi ON oi."id" = j."orderItemId"
JOIN "orders" o ON o."id" = oi."orderId"
JOIN "users" u ON u."id" = o."userId"
WHERE j."status" = 'DONE' AND j."finishedAt" IS NOT NULL
GROUP BY oi."id", oi."name", oi."productId", oi."quantity", o."total", u."name", u."email";

-- Studio prints and failed prints of a product: one piece per recording (its colours were
-- recorded together, in the same second, by the same person, with the same note).
INSERT INTO "pieces" ("id", "name", "productId", "quantity", "stage", "note", "printedAt",
                      "grams", "cost", "createdById", "updatedAt")
SELECT gen_random_uuid(), left(p."name", 200), m."productId", max(coalesce(m."quantity", 1)),
       CASE WHEN m."kind" = 'FAILED_PRINT' THEN 'FAILED'::"PieceStage" ELSE 'IN_LAB'::"PieceStage" END,
       m."note", min(m."createdAt"), (-sum(m."grams"))::int, sum(coalesce(m."cost", 0)),
       m."createdById", now()
FROM "stock_movements" m
JOIN "products" p ON p."id" = m."productId"
WHERE m."kind" IN ('USED', 'FAILED_PRINT') AND m."printJobId" IS NULL
GROUP BY m."productId", p."name", m."kind", m."note", m."createdById",
         date_trunc('second', m."createdAt");

-- Each piece's first move: where it starts.
INSERT INTO "piece_moves" ("id", "pieceId", "stage", "holder", "byId", "at")
SELECT gen_random_uuid(), "id", "stage", "holder", "createdById", "printedAt" FROM "pieces";
