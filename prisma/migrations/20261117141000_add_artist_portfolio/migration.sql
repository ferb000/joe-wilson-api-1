-- CreateTable
CREATE TABLE "artist_regions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "artist_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_countries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "artist_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_genres" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "artist_genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "biography" TEXT,
    "countryId" TEXT NOT NULL,
    "genreId" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_projects" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artist_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_videos" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT,
    "youtubeId" TEXT NOT NULL,
    "customCoverUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artist_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_thumbnails" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "artist_thumbnails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_credits" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Joe Wilson',
    "role" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "artist_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "artist_regions_name_key" ON "artist_regions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "artist_regions_slug_key" ON "artist_regions"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "artist_countries_name_key" ON "artist_countries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "artist_countries_code_key" ON "artist_countries"("code");

-- CreateIndex
CREATE INDEX "artist_countries_regionId_orderIndex_idx" ON "artist_countries"("regionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "artist_genres_name_key" ON "artist_genres"("name");

-- CreateIndex
CREATE UNIQUE INDEX "artist_genres_slug_key" ON "artist_genres"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "artists_slug_key" ON "artists"("slug");

-- CreateIndex
CREATE INDEX "artists_isPublished_orderIndex_id_idx" ON "artists"("isPublished", "orderIndex", "id");

-- CreateIndex
CREATE INDEX "artists_countryId_isPublished_idx" ON "artists"("countryId", "isPublished");

-- CreateIndex
CREATE INDEX "artists_genreId_isPublished_idx" ON "artists"("genreId", "isPublished");

-- CreateIndex
CREATE INDEX "artist_projects_artistId_isPublished_orderIndex_id_idx" ON "artist_projects"("artistId", "isPublished", "orderIndex", "id");

-- CreateIndex
CREATE INDEX "artist_videos_projectId_isPublished_orderIndex_id_idx" ON "artist_videos"("projectId", "isPublished", "orderIndex", "id");

-- CreateIndex
CREATE UNIQUE INDEX "artist_videos_projectId_youtubeId_key" ON "artist_videos"("projectId", "youtubeId");

-- CreateIndex
CREATE INDEX "artist_thumbnails_videoId_orderIndex_id_idx" ON "artist_thumbnails"("videoId", "orderIndex", "id");

-- CreateIndex
CREATE INDEX "artist_credits_projectId_orderIndex_id_idx" ON "artist_credits"("projectId", "orderIndex", "id");

-- AddForeignKey
ALTER TABLE "artist_countries" ADD CONSTRAINT "artist_countries_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "artist_regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "artist_countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "artist_genres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_projects" ADD CONSTRAINT "artist_projects_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_videos" ADD CONSTRAINT "artist_videos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "artist_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_thumbnails" ADD CONSTRAINT "artist_thumbnails_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "artist_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_credits" ADD CONSTRAINT "artist_credits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "artist_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
