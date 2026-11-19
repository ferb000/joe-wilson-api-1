import { mkdir, writeFile, unlink } from 'fs/promises';
import path from 'path';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FileType, MediaLibrary, Prisma, VideoTranscode } from '@prisma/client';
import { env } from '../../config/env';
import { s3 } from '../../config/s3';
import { localStorageEnabled } from './local.storage';
import { HttpError } from '../../utils/httpError';
import { getPresignedDownloadUrl } from '../../utils/signedUrl';

export const mimeExtensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'text/plain': 'txt',
};
export function fileType(mime: string): FileType {
  return mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime.includes('zip') ? 'archive' : 'document';
}
export function validSignature(buffer: Buffer, mime: string) {
  if (mime === 'image/jpeg') return buffer.subarray(0,3).equals(Buffer.from([255,216,255]));
  if (mime === 'image/png') return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(buffer.subarray(0,6).toString());
  if (mime === 'image/webp') return buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP';
  if (mime === 'video/webm') return buffer.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  if (mime === 'video/mp4' || mime === 'video/quicktime') return ['ftyp','moov','mdat','wide'].includes(buffer.subarray(4,8).toString());
  return true;
}
export const localStorage = () => env.NODE_ENV === 'development' && !!env.MEDIA_LOCAL_DIR;
export function mediaUrl(key: string): string {
  if (/^https?:\/\//i.test(key)) return key; // Preserve existing legacy records.
  if (key.startsWith('local:')) return `${env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, '')}/v1/uploads/${key.slice(6).split('/').map(encodeURIComponent).join('/')}`;
  const base = env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, '') || (env.S3_ENDPOINT ? `${env.S3_ENDPOINT.replace(/\/$/, '')}/${env.S3_BUCKET}` : `https://${env.S3_BUCKET}.s3.${env.S3_REGION || 'us-east-1'}.amazonaws.com`);
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
export function mediaDTO(media: MediaLibrary) {
  const { storageKey, sizeBytes, uploadedBy: _owner, ...rest } = media;
  return { ...rest, sizeBytes: Number(sizeBytes), url: mediaUrl(storageKey) };
}

export function publicMediaUrl(key: string) {
  if (localStorageEnabled) {
    return `${env.API_PUBLIC_URL.replace(/\/$/, '')}/v1/local-files/public/${key.replace(/^public\//, '').split('/').map(encodeURIComponent).join('/')}`;
  }
  if (!env.S3_PUBLIC_BASE_URL) throw new HttpError(503, 'Public media delivery is not configured');
  return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function mediaResponse(
  media: MediaLibrary & { transcode?: VideoTranscode | null },
  admin = false,
  expiresIn = 900,
) {
  const { storageKey, deleting, transcode, ...safe } = media;
  return {
    ...safe,
    sizeBytes: media.sizeBytes.toString(),
    ...(admin && { storageKey, deleting }),
    ...(media.fileType === 'video' && { processingStatus: transcode?.status || 'not_queued' }),
    url: !admin && media.fileType === 'video'
      ? null
      : media.isPublic
        ? publicMediaUrl(storageKey)
        : await getPresignedDownloadUrl(storageKey, expiresIn),
  };
}

export async function lockMedia(
  tx: Prisma.TransactionClient,
  id: string,
  allowDeleting = false,
) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM media_library WHERE id = ${id} FOR UPDATE`);
  const media = await tx.mediaLibrary.findUnique({ where: { id } });
  if (!media || (media.deleting && !allowDeleting)) throw new HttpError(409, 'Media is unavailable');
  return media;
}

export async function recordingData(
  tx: Prisma.TransactionClient,
  input: { videoMediaId?: string | null; videoStorageKey?: string | null },
) {
  if (input.videoMediaId === undefined && input.videoStorageKey === undefined) return {};
  if ((input.videoMediaId === null && input.videoStorageKey) || (input.videoStorageKey === null && input.videoMediaId)) {
    throw new HttpError(400, 'Recording identifiers do not match');
  }
  if (input.videoMediaId === null || input.videoStorageKey === null) return { videoMediaId: null, videoStorageKey: null };

  const media = input.videoMediaId
    ? await tx.mediaLibrary.findUnique({ where: { id: input.videoMediaId } })
    : await tx.mediaLibrary.findUnique({ where: { storageKey: input.videoStorageKey! } });
  if (!media) throw new HttpError(400, 'Upload or import the recording into the media library first');

  const locked = await lockMedia(tx, media.id);
  if (!['audio', 'video'].includes(locked.fileType) || locked.isPublic) {
    throw new HttpError(400, 'Recordings must use private audio or video media');
  }
  if (input.videoMediaId && input.videoStorageKey && input.videoStorageKey !== locked.storageKey) {
    throw new HttpError(400, 'Recording identifiers do not match');
  }
  return { videoMediaId: locked.id, videoStorageKey: locked.storageKey };
}

function localPath(key: string) {
  const root = path.resolve(env.MEDIA_LOCAL_DIR!);
  const file = path.resolve(root, key.slice(6));
  if (!file.startsWith(root + path.sep)) throw new Error('Invalid local media path');
  return file;
}
export async function storeFile(key: string, file: Express.Multer.File) {
  if (key.startsWith('local:')) {
    const target = localPath(key); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.buffer, { flag: 'wx' });
  } else await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype, ContentDisposition: file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') ? 'inline' : 'attachment' }));
}
export async function removeFile(key: string) {
  if (key.startsWith('local:')) { try { await unlink(localPath(key)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
  else {
    let objectKey = key;
    if (/^https?:\/\//i.test(key)) {
      const prefix = env.S3_ENDPOINT ? `${env.S3_ENDPOINT.replace(/\/$/, '')}/${env.S3_BUCKET}/` : `https://${env.S3_BUCKET}.s3.${env.S3_REGION || 'us-east-1'}.amazonaws.com/`;
      if (!key.startsWith(prefix)) throw new Error('Cannot identify legacy storage object');
      objectKey = decodeURIComponent(key.slice(prefix.length));
    }
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
  }
}
