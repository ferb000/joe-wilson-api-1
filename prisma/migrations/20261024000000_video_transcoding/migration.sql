CREATE TYPE "TranscodeStatus" AS ENUM ('queued', 'processing', 'ready', 'failed');
CREATE TABLE "video_transcodes" (
  "id" TEXT PRIMARY KEY, "mediaId" TEXT NOT NULL UNIQUE,
  "status" "TranscodeStatus" NOT NULL DEFAULT 'queued', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedUntil" TIMESTAMP(3), "leaseToken" TEXT,
  "outputPrefix" TEXT, "durationSeconds" DOUBLE PRECISION, "width" INTEGER, "height" INTEGER,
  "renditions" JSONB, "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_transcodes_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media_library"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "video_transcodes_status_availableAt_idx" ON "video_transcodes"("status", "availableAt");
-- Queue existing private video-library entries without changing their source objects.
INSERT INTO "video_transcodes" ("id", "mediaId", "updatedAt")
SELECT gen_random_uuid()::text, "id", CURRENT_TIMESTAMP FROM "media_library"
WHERE "fileType" = 'video' AND NOT "isPublic" AND NOT "deleting";
