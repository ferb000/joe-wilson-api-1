-- Retain legacy provider identifiers for recording export; new playback uses S3.
ALTER TABLE "sessions" ADD COLUMN "videoStorageKey" TEXT;
UPDATE "media_library" SET "storageKey" = substring("storageKey" from '/(media/[^?#]+)')
WHERE "storageKey" ~ '^https?://' AND "storageKey" ~ '/media/[^?#]+$';
UPDATE "media_library" SET "fileType" = 'video' WHERE "mimeType" LIKE 'video/%';
UPDATE "media_library" SET "fileType" = 'audio' WHERE "mimeType" LIKE 'audio/%';
