import { mediaDTO, mediaUrl } from '../media/media.service';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { parseYouTubeId } from './youtube';
import type { videoInput } from './artists.schema';
import { prisma } from '../../config/database';
import type { ArtistFilters, ProjectFilters } from './artists.schema';

export const ordered = [{ orderIndex: 'asc' as const }, { id: 'asc' as const }];
export const publicProjectWhere: Prisma.ArtistProjectWhereInput = { isPublished: true, artist: { isPublished: true }, videos: { some: { isPublished: true } } };
export const publicArtistInclude = {
  country: { include: { region: true } }, genre: true,
  projects: {
    where: publicProjectWhere, orderBy: ordered,
    include: {
      credits: { orderBy: ordered },
      videos: { where: { isPublished: true }, orderBy: ordered, include: { thumbnails: { orderBy: ordered }, media: true } },
    },
  },
} satisfies Prisma.ArtistInclude;
export const adminArtistInclude = {
  country: { include: { region: true } }, genre: true,
} satisfies Prisma.ArtistInclude;
export const publicProjectInclude = {
  credits: { orderBy: ordered },
  videos: { where: { isPublished: true }, orderBy: ordered, include: { thumbnails: { orderBy: ordered }, media: true } },
} satisfies Prisma.ArtistProjectInclude;
export const adminProjectInclude = {
  credits: { orderBy: ordered },
  videos: { orderBy: ordered, include: { thumbnails: { orderBy: ordered }, media: true } },
} satisfies Prisma.ArtistProjectInclude;

type ProjectRow = Prisma.ArtistProjectGetPayload<{ include: typeof adminProjectInclude }>;
export function videoDTO(video: Prisma.ArtistVideoGetPayload<{ include: { thumbnails: true; media: true } }>) {
  const { media, ...record } = video;
  const generatedThumbnailUrl = video.youtubeId ? `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg` : null;
  return {
    ...record, media: media ? mediaDTO(media) : null,
    videoUrl: media ? mediaUrl(media.storageKey) : null,
    youtubeUrl: video.youtubeId ? `https://www.youtube.com/watch?v=${video.youtubeId}` : null,
    embedUrl: video.youtubeId ? `https://www.youtube-nocookie.com/embed/${video.youtubeId}` : null,
    generatedThumbnailUrl,
    thumbnailUrl: video.customCoverUrl ?? video.thumbnails[0]?.url ?? generatedThumbnailUrl,
  };
}
export async function normalizeVideo(data: Partial<z.infer<typeof videoInput>>, create = false, current?: { source: string; youtubeId: string | null; mediaId: string | null }) {
  const { youtubeUrl, youtubeId, mediaId, source, ...rest } = data;
  const issue = (message: string) => new z.ZodError([{ code: 'custom', path: ['source'], message }]);
  if (!source && !youtubeUrl && !youtubeId && !mediaId) {
    if (create) throw issue('Add a YouTube link or choose an uploaded video');
    return rest;
  }
  const selected = source ?? (mediaId ? 'upload' : 'youtube');
  if (selected === 'upload') {
    if (youtubeUrl || youtubeId) throw issue('Choose one video source: YouTube or uploaded file');
    const chosenId = mediaId ?? (current?.source === 'upload' ? current.mediaId : null);
    if (!chosenId) throw issue('Choose a video file from the media library');
    const media = await prisma.mediaLibrary.findUnique({ where: { id: chosenId } });
    if (!media || media.fileType !== 'video' || !['video/mp4','video/webm','video/quicktime'].includes(media.mimeType)) throw issue('Choose an uploaded MP4, WebM or MOV video');
    return { ...rest, source: 'upload', mediaId: chosenId, youtubeId: null };
  }
  if (mediaId) throw issue('Choose one video source: YouTube or uploaded file');
  const parsedId = youtubeUrl ? parseYouTubeId(youtubeUrl) : null;
  const chosenId = parsedId || youtubeId || (current?.source === 'youtube' ? current.youtubeId : null);
  if ((youtubeUrl && !parsedId) || (parsedId && youtubeId && parsedId !== youtubeId) || !chosenId) throw issue('Supply a valid YouTube link');
  return { ...rest, source: 'youtube', youtubeId: chosenId, mediaId: null };
}
export function projectDTO(project: ProjectRow) {
  const videos = project.videos.map(videoDTO);
  return {
    ...project, videos,
    role: project.credits.filter(credit => credit.name === 'Joe Wilson').map(credit => credit.role).join(' · '),
    source: videos[0]?.source ?? null,
    videoUrl: videos[0]?.videoUrl ?? null,
    youtubeId: videos[0]?.youtubeId ?? null,
    youtubeUrl: videos[0]?.youtubeUrl ?? null,
    embedUrl: videos[0]?.embedUrl ?? null,
    thumbnailUrl: videos[0]?.thumbnailUrl ?? null,
  };
}
export function artistDTO(artist: Prisma.ArtistGetPayload<{ include: typeof adminArtistInclude }> & { projects?: ProjectRow[] }) {
  return {
    ...artist,
    country: artist.country.name,
    region: artist.country.region.name,
    regionId: artist.country.regionId,
    genre: artist.genre.name,
    projects: artist.projects?.map(projectDTO),
  };
}

const matchNameOrSlug = (value: string) => ({ OR: [
  { name: { equals: value, mode: 'insensitive' as const } },
  { slug: { equals: value, mode: 'insensitive' as const } },
] });
export function artistWhere(filters: ArtistFilters, admin: boolean): Prisma.ArtistWhereInput {
  const conditions: Prisma.ArtistWhereInput[] = [];
  if (!admin) conditions.push({ isPublished: true });
  else if (filters.isPublished !== undefined) conditions.push({ isPublished: filters.isPublished });
  if (filters.region && !['all', 'all regions'].includes(filters.region.toLowerCase())) {
    conditions.push({ country: { region: matchNameOrSlug(filters.region) } });
  }
  if (filters.country && !['all', 'all countries'].includes(filters.country.toLowerCase())) {
    conditions.push(filters.country.toLowerCase() === 'other countries'
      ? { country: { code: { notIn: ['GH', 'NG'] } } }
      : { country: { OR: [{ name: { equals: filters.country, mode: 'insensitive' } }, { code: { equals: filters.country, mode: 'insensitive' } }] } });
  }
  if (filters.genre && filters.genre.toLowerCase() !== 'all') conditions.push({ genre: matchNameOrSlug(filters.genre) });
  if (filters.regionId) conditions.push({ country: { regionId: filters.regionId } });
  if (filters.countryId) conditions.push({ countryId: filters.countryId });
  if (filters.genreId) conditions.push({ genreId: filters.genreId });
  if (filters.q) conditions.push({ name: { contains: filters.q, mode: 'insensitive' } });
  return { AND: conditions };
}

export async function artistExists(artistId: string, admin: boolean) {
  return prisma.artist.findFirst({ where: { id: artistId, ...(!admin && { isPublished: true }) }, select: { id: true } });
}
export async function projectExists(artistId: string, projectId: string, admin: boolean) {
  return prisma.artistProject.findFirst({ where: {
    id: projectId, artistId,
    ...(!admin && { ...publicProjectWhere, artist: { isPublished: true } }),
  }, select: { id: true } });
}
export async function videoExists(artistId: string, projectId: string, videoId: string, admin: boolean) {
  return prisma.artistVideo.findFirst({ where: {
    id: videoId, projectId, project: { artistId },
    ...(!admin && { isPublished: true, project: { artistId, isPublished: true, artist: { isPublished: true } } }),
  }, select: { id: true } });
}

export function generatedProjectSlug(title: string, projectId: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120).replace(/-$/, '') || 'project';
  return `${base}-${projectId}`;
}
export function createProjectData(data: z.infer<typeof import('./artists.schema').projectInput>, artistId: string) {
  const id = randomUUID();
  return { ...data, id, artistId, slug: data.slug ?? generatedProjectSlug(data.title, id) };
}
export function projectWhere(artistId: string, filters: ProjectFilters, admin: boolean): Prisma.ArtistProjectWhereInput {
  return {
    artistId,
    ...(!admin ? publicProjectWhere : filters.isPublished !== undefined ? { isPublished: filters.isPublished } : {}),
    ...(filters.q && { OR: [{ title: { contains: filters.q, mode: 'insensitive' as const } }, { description: { contains: filters.q, mode: 'insensitive' as const } }] }),
    ...(filters.credit && { credits: { some: { role: { contains: filters.credit, mode: 'insensitive' as const } } } }),
  };
}
export async function relatedProjectList(artistId: string, projectId: string, filters: ProjectFilters, admin: boolean) {
  const where = { ...projectWhere(artistId, filters, admin), id: { not: projectId } };
  const [rows, total] = await prisma.$transaction([
    prisma.artistProject.findMany({ where, orderBy: ordered, skip: (filters.page - 1) * filters.limit, take: filters.limit, include: admin ? adminProjectInclude : publicProjectInclude }),
    prisma.artistProject.count({ where }),
  ]);
  return { projects: rows.map(projectDTO), total };
}
export async function projectDetails(artistId: string, projectId: string, admin: boolean) {
  const row = await prisma.artistProject.findFirst({
    where: { id: projectId, artistId, ...(!admin && publicProjectWhere) },
    include: { ...(admin ? adminProjectInclude : publicProjectInclude), artist: { include: adminArtistInclude } },
  });
  if (!row) return null;
  const related = await relatedProjectList(artistId, projectId, { page: 1, limit: 3 }, admin);
  const base = `/v1/artists/${encodeURIComponent(row.artist.slug)}`;
  const self = `${base}/projects/${encodeURIComponent(row.slug)}`;
  return {
    ...projectDTO(row), artist: artistDTO(row.artist), relatedProjects: related.projects,
    links: { self, artist: base, projects: `${base}/projects`, related: `${self}/related` },
  };
}
