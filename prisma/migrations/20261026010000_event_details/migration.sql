ALTER TABLE "events" ADD COLUMN "description" TEXT, ADD COLUMN "location" TEXT;
UPDATE "events" SET "location" = NULLIF(concat_ws(', ', "venue", "city", "country"), '');
