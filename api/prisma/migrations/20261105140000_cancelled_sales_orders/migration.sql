-- A confirmed quotation is a sales order: cancelling one cancels the other, and the
-- cancelled quotation keeps the link to its cancelled order.
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_confirmed_check";
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_confirmed_check" CHECK (
  ("status" <> 'CONFIRMED' OR "orderId" IS NOT NULL)
  AND ("orderId" IS NULL OR "status" IN ('CONFIRMED', 'CANCELLED'))
);
