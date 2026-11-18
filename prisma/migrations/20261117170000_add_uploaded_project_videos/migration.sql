ALTER TABLE "artist_videos" ALTER COLUMN "youtubeId" DROP NOT NULL;
ALTER TABLE "artist_videos" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE "artist_videos" ADD COLUMN "mediaId" TEXT;
CREATE INDEX "artist_videos_mediaId_idx" ON "artist_videos"("mediaId");
ALTER TABLE "artist_videos" ADD CONSTRAINT "artist_videos_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media_library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "artist_videos" ADD CONSTRAINT "artist_videos_source_check" CHECK (
  ("source" = 'youtube' AND "youtubeId" IS NOT NULL AND "mediaId" IS NULL) OR
  ("source" = 'upload' AND "youtubeId" IS NULL AND "mediaId" IS NOT NULL)
);
