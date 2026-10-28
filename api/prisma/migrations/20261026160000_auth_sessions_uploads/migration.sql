/*
  Warnings:

  - You are about to drop the column `referenceImageKey` on the `leads` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('QUARANTINED', 'CLEAN', 'REJECTED');

-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('LEAD_REFERENCE', 'PRODUCT_IMAGE', 'PRODUCT_MODEL');

-- AlterTable
ALTER TABLE "leads" DROP COLUMN "referenceImageKey",
ADD COLUMN     "referenceUploadId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" INET,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'QUARANTINED',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectedAt" TIMESTAMPTZ(3),

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_storageKey_key" ON "uploads"("storageKey");

-- CreateIndex
CREATE INDEX "uploads_status_createdAt_idx" ON "uploads"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_referenceUploadId_fkey" FOREIGN KEY ("referenceUploadId") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints.
-- ---------------------------------------------------------------------------

-- Staff and admins sign in with Google Workspace only; a password on such an account
-- would be a second, unprotected way in.
ALTER TABLE "users" ADD CONSTRAINT "users_staff_no_password_check"
  CHECK ("role" = 'CUSTOMER' OR "passwordHash" IS NULL);

ALTER TABLE "uploads" ADD CONSTRAINT "uploads_size_check" CHECK ("sizeBytes" > 0);
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
