-- AlterTable
ALTER TABLE "print_jobs" ADD COLUMN     "calendarEventId" TEXT;


-- Hand-written: a job needs positive grams and hours, and a machine name.
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_values_check" CHECK ("grams" > 0 AND "hours" > 0 AND char_length("machine") BETWEEN 1 AND 50);
