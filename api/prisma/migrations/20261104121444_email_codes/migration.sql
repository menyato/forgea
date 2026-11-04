-- CreateTable
CREATE TABLE "email_codes" (
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attemptsLeft" INTEGER NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_codes_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: never negative tries, and a code always expires after it was sent.
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_attempts_left_check" CHECK ("attemptsLeft" >= 0);
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_expires_after_sent_check" CHECK ("expiresAt" > "sentAt");
