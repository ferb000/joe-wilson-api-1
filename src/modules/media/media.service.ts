import { FileType, Prisma, MediaLibrary, VideoTranscode } from '@prisma/client';
import { env } from '../../config/env';
import { HttpError } from '../../utils/httpError';
import { getPresignedDownloadUrl } from '../../utils/signedUrl';
export const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'video/mp4', 'video/quicktime', 'video/webm', 'application/zip', 'application/x-zip-compressed', 'text/plain'];
export function fileType(mime: string): FileType {
  if (mime.startsWith('image/')) return FileType.image;
  if (mime.startsWith('audio/')) return FileType.audio;
  if (mime.startsWith('video/')) return FileType.video;
  return mime.includes('zip') ? FileType.archive : FileType.document;
}
export function publicMediaUrl(key: string) {
  if (!env.S3_PUBLIC_BASE_URL) throw new HttpError(503, 'Public media delivery is not configured');
  return env.S3_PUBLIC_BASE_URL.replace(/\/$/, '') + '/' + key.split('/').map(encodeURIComponent).join('/');
}
export async function mediaResponse(media: MediaLibrary & { transcode?: VideoTranscode | null }, admin = false, expiresIn = 900) {
  const { storageKey, deleting, transcode, ...safe } = media;
  return { ...safe, sizeBytes: media.sizeBytes.toString(), ...(admin && { storageKey, deleting }), ...(media.fileType === 'video' && { processingStatus: transcode?.status || 'not_queued' }), url: !admin && media.fileType === 'video' ? null : media.isPublic ? publicMediaUrl(storageKey) : await getPresignedDownloadUrl(storageKey, expiresIn) };
}
export async function lockMedia(tx: Prisma.TransactionClient, id: string, allowDeleting = false) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM media_library WHERE id = ${id} FOR UPDATE`);
  const media = await tx.mediaLibrary.findUnique({ where: { id } });
  if (!media || (media.deleting && !allowDeleting)) throw new HttpError(409, 'Media is unavailable');
  return media;
}
export async function recordingData(tx: Prisma.TransactionClient, input: { videoMediaId?: string | null; videoStorageKey?: string | null }) {
  if (input.videoMediaId === undefined && input.videoStorageKey === undefined) return {};
  if ((input.videoMediaId === null && input.videoStorageKey) || (input.videoStorageKey === null && input.videoMediaId)) throw new HttpError(400, 'Recording identifiers do not match');
  if (input.videoMediaId === null || input.videoStorageKey === null) return { videoMediaId: null, videoStorageKey: null };
  const media = input.videoMediaId ? await tx.mediaLibrary.findUnique({ where: { id: input.videoMediaId } }) : await tx.mediaLibrary.findUnique({ where: { storageKey: input.videoStorageKey! } });
  if (!media) throw new HttpError(400, 'Upload or import the recording into the media library first');
  const locked = await lockMedia(tx, media.id);
  if (!['audio', 'video'].includes(locked.fileType) || locked.isPublic) throw new HttpError(400, 'Recordings must use private audio or video media');
  if (input.videoMediaId && input.videoStorageKey && input.videoStorageKey !== locked.storageKey) throw new HttpError(400, 'Recording identifiers do not match');
  return { videoMediaId: locked.id, videoStorageKey: locked.storageKey };
}
