-- AlterTable
ALTER TABLE "piece_moves" ADD COLUMN     "holderId" UUID;

-- AlterTable
ALTER TABLE "pieces" ADD COLUMN     "holderId" UUID;

-- AddForeignKey
ALTER TABLE "pieces" ADD CONSTRAINT "pieces_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_moves" ADD CONSTRAINT "piece_moves_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: a piece's moves stay as they were, except whose account they point at (a
-- customer merged into another keeps the pieces they had).
CREATE OR REPLACE FUNCTION refuse_piece_move_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'holderId' - 'byId') = (to_jsonb(OLD) - 'holderId' - 'byId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'piece moves are append-only';
END;
$$;
