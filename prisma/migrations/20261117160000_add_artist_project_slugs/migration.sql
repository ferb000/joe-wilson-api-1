-- Backfill existing records without publishing content or modifying UUIDs.
-- Full UUID suffixes preserve duplicate titles and guarantee per-artist uniqueness.
ALTER TABLE "artist_projects" ADD COLUMN "slug" TEXT;
UPDATE "artist_projects"
SET "slug" = COALESCE(NULLIF(rtrim(left(trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), 120), '-'), ''), 'project') || '-' || "id";
ALTER TABLE "artist_projects" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "artist_projects_artistId_slug_key" ON "artist_projects"("artistId", "slug");
