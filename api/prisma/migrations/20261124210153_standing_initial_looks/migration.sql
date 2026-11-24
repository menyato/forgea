-- A standing initial may keep decorations too: they choose the looks its page starts from (a girl's
-- or a boy's; none: every look). A big initial still needs them; every other style has none.
ALTER TABLE "products" DROP CONSTRAINT "products_text_decor";
ALTER TABLE "products" ADD CONSTRAINT "products_text_decor" CHECK (
  CASE "textStyle"::text
    WHEN 'INITIAL_NAME' THEN "textDecor" IS NOT NULL
    WHEN 'STANDING_INITIAL' THEN true
    ELSE "textDecor" IS NULL
  END
);
