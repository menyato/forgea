-- Order numbers become "FG-" + year + a running count ("FG-2026-0001"). The random ones
-- given before stay valid.
CREATE TABLE "order_sequences" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("year")
);

ALTER TABLE "orders" DROP CONSTRAINT "orders_order_number_format_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_number_format_check" CHECK (
  "orderNumber" ~ '^FG-([0-9]{4}-[0-9]{4,}|[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10})$'
);
