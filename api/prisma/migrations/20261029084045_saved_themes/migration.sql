-- CreateTable
CREATE TABLE "saved_themes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "palette" JSONB NOT NULL,
    "basedOn" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "saved_themes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_themes_name_key" ON "saved_themes"("name");

-- AddForeignKey
ALTER TABLE "saved_themes" ADD CONSTRAINT "saved_themes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: a name the list can show.
ALTER TABLE "saved_themes" ADD CONSTRAINT "saved_themes_name_length"
  CHECK (char_length("name") BETWEEN 1 AND 60);
