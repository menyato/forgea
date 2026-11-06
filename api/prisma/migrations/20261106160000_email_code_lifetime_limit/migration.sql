-- Wrong codes over an account's whole life, kept when a new code replaces the last: past the
-- limit, no code confirms it (the owner proves the address with a password reset instead).
ALTER TABLE "email_codes" ADD COLUMN "wrongTotal" INTEGER NOT NULL DEFAULT 0;
