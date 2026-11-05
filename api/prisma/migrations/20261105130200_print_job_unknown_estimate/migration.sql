-- A print planned by itself for a product with no estimate starts at 0 g (filled in when it
-- is planned); "print_jobs_values" keeps grams and hours from going below 0.
ALTER TABLE "print_jobs" DROP CONSTRAINT "print_jobs_inputs_check";
