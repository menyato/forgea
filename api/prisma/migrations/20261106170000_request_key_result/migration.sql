-- What a form's first submission made (an entry, a print run): a second one opens it.
ALTER TABLE "request_keys" ADD COLUMN "result" TEXT;
