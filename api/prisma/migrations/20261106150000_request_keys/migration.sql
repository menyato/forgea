-- One-time keys of forms that record stock and money: the same form sent twice counts once.
CREATE TABLE "request_keys" (
    "key" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "request_keys_pkey" PRIMARY KEY ("key")
);
