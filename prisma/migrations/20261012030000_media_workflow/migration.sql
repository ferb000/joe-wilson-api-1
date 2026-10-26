ALTER TABLE "media_library" ADD COLUMN "deleting" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sessions" ADD COLUMN "videoMediaId" TEXT;
UPDATE "sessions" AS s SET "videoMediaId" = m.id FROM "media_library" AS m WHERE s."videoStorageKey" = m."storageKey";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_videoMediaId_fkey" FOREIGN KEY ("videoMediaId") REFERENCES "media_library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "media_uploads" ("id" TEXT PRIMARY KEY, "storageKey" TEXT NOT NULL UNIQUE, "uploadId" TEXT NOT NULL, "filename" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" BIGINT NOT NULL, "uploadedBy" TEXT NOT NULL, "isPublic" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'uploading', "expiresAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "media_uploads_expiresAt_idx" ON "media_uploads"("expiresAt");
