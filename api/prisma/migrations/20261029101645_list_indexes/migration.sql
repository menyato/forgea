-- CreateIndex
CREATE INDEX "journal_entries_state_date_createdAt_idx" ON "journal_entries"("state", "date", "createdAt");
