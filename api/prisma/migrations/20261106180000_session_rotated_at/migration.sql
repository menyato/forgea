-- When a refresh token was replaced by rotation (not ended by sign-out or reuse): a second
-- tab refreshing with it a moment later gets a session too, instead of signing everyone out.
ALTER TABLE "sessions" ADD COLUMN "rotatedAt" TIMESTAMPTZ(3);
