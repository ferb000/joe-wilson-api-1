import { mkdir, writeFile, unlink } from 'fs/promises';
import path from 'path';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FileType, MediaLibrary } from '@prisma/client';
import { env } from '../../config/env';
import { s3 } from '../../config/s3';

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
