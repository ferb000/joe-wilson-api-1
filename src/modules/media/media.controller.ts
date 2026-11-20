import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, HeadObjectCommand, ListPartsCommand, Part, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { ok, created, badRequest, notFound } from '../../utils/response';
import { getPaginationMeta, getPaginationParams, getSkip } from '../../utils/pagination';
import { localStorage, mediaDTO, mediaResponse, mimeExtensions, fileType, validSignature, storeFile, removeFile } from './media.service';
import { storage } from '../../config/s3';
import { localStorageEnabled } from './local.storage';
import { localFileUrl } from './local.files.routes';
import { HttpError } from '../../utils/httpError';

export const PART_SIZE = 10 * 1024 * 1024;
const multipartUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().refine(mime => Object.hasOwn(mimeExtensions, mime), 'Unsupported file type'),
  sizeBytes: z.number().int().positive().max(env.S3_MAX_UPLOAD_BYTES),
  isPublic: z.boolean().default(false),
}).strict().refine(input => !input.isPublic || input.mimeType.startsWith('image/'), 'Only images can be public');

function uploadKey(filename: string, isPublic: boolean) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
  return `${isPublic ? 'public' : 'media'}/${randomUUID()}-${safeFilename}`;
}

async function pendingUpload(id: string, userId: string) {
  const upload = await prisma.mediaUpload.findFirst({ where: { id, uploadedBy: userId } });
  if (!upload) throw new HttpError(404, 'Upload not found');
  if (upload.expiresAt <= new Date()) throw new HttpError(410, 'Upload expired; start it again');
  return upload;
}

export function verifyUploadParts(parts: Part[], expectedSize: number) {
  parts.sort((a, b) => (a.PartNumber || 0) - (b.PartNumber || 0));
  if (parts.length !== Math.ceil(expectedSize / PART_SIZE) || parts.some((part, index) =>
    part.PartNumber !== index + 1 || !part.ETag || part.Size !== Math.min(PART_SIZE, expectedSize - index * PART_SIZE))) {
    throw new HttpError(400, 'Uploaded parts do not match the declared file size');
  }
}

export async function startUpload(req: Request, res: Response) {
  const input = multipartUploadSchema.parse(req.body);
  if (input.isPublic && !localStorageEnabled && !env.S3_PUBLIC_BASE_URL) {
    return res.status(503).json({ success: false, error: 'Public image delivery is not configured' });
  }
  if (!localStorageEnabled && !env.S3_BUCKET) {
    return res.status(503).json({ success: false, error: 'File storage is not configured' });
  }
  const storageKey = uploadKey(input.filename, input.isPublic);
  const started = await storage.send(new CreateMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: storageKey, ContentType: input.mimeType }));
  if (!started.UploadId) throw new HttpError(502, 'Storage did not create an upload');
  try {
    const record = await prisma.mediaUpload.create({ data: {
      storageKey, uploadId: started.UploadId, filename: input.filename, mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes), uploadedBy: (req as any).user.id, isPublic: input.isPublic,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } });
    return created(res, { id: record.id, partSize: PART_SIZE, partsCount: Math.ceil(input.sizeBytes / PART_SIZE), expiresAt: record.expiresAt });
  } catch (error) {
    await storage.send(new AbortMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: storageKey, UploadId: started.UploadId })).catch(() => {});
    throw error;
  }
}

export async function uploadPart(req: Request, res: Response) {
  const upload = await pendingUpload(req.params.id, (req as any).user.id);
  if (upload.status !== 'uploading') return res.status(409).json({ success: false, error: 'Upload is being finalized' });
  const { partNumber } = z.object({ partNumber: z.number().int().min(1).max(Math.ceil(Number(upload.sizeBytes) / PART_SIZE)) }).strict().parse(req.body);
  const command = new UploadPartCommand({ Bucket: env.S3_BUCKET, Key: upload.storageKey, UploadId: upload.uploadId, PartNumber: partNumber });
  const url = localStorageEnabled
    ? localFileUrl(upload.storageKey, 900, { uploadId: upload.uploadId, partNumber })
    : await getSignedUrl(storage, command, { expiresIn: 900 });
  return ok(res, { url, expiresIn: 900 });
}

export async function completeUpload(req: Request, res: Response) {
  const upload = await pendingUpload(req.params.id, (req as any).user.id);
  const reserved = await prisma.mediaUpload.updateMany({ where: { id: upload.id, OR: [
    { status: 'uploading' },
    { status: 'finalizing', updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
  ] }, data: { status: 'finalizing' } });
  if (reserved.count !== 1) return res.status(409).json({ success: false, error: 'Upload is already being finalized' });

  try {
    let object: { ContentLength?: number; ContentType?: string } | undefined;
    try { object = await storage.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: upload.storageKey })); }
    catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404 && (error as { name?: string }).name !== 'NoSuchKey') throw error;
    }
    if (!object) {
      const parts: Part[] = [];
      let marker: string | undefined;
      do {
        const page = await storage.send(new ListPartsCommand({ Bucket: env.S3_BUCKET, Key: upload.storageKey, UploadId: upload.uploadId, PartNumberMarker: marker }));
        parts.push(...(page.Parts || []));
        marker = page.IsTruncated ? String(page.NextPartNumberMarker) : undefined;
      } while (marker !== undefined);
      verifyUploadParts(parts, Number(upload.sizeBytes));
      await storage.send(new CompleteMultipartUploadCommand({
        Bucket: env.S3_BUCKET, Key: upload.storageKey, UploadId: upload.uploadId,
        MultipartUpload: { Parts: parts.map(part => ({ PartNumber: part.PartNumber, ETag: part.ETag })) },
      }));
      object = await storage.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: upload.storageKey }));
    }
    if (object.ContentLength !== Number(upload.sizeBytes) || object.ContentType !== upload.mimeType) {
      throw new HttpError(400, 'Stored object does not match the upload details');
    }
    const media = await prisma.$transaction(async tx => {
      const createdMedia = await tx.mediaLibrary.create({ data: {
        filename: upload.filename, storageKey: upload.storageKey, mimeType: upload.mimeType,
        fileType: fileType(upload.mimeType), sizeBytes: upload.sizeBytes, uploadedBy: upload.uploadedBy,
        isPublic: upload.isPublic,
        ...(upload.mimeType.startsWith('video/') && { transcode: { create: {} } }),
      } });
      await tx.mediaUpload.delete({ where: { id: upload.id } });
      return tx.mediaLibrary.findUniqueOrThrow({ where: { id: createdMedia.id }, include: { transcode: true } });
    });
    return created(res, await mediaResponse(media, true));
  } catch (error) {
    await prisma.mediaUpload.updateMany({ where: { id: upload.id, status: 'finalizing' }, data: { status: 'uploading' } }).catch(() => {});
    throw error;
  }
}

export async function abortUpload(req: Request, res: Response) {
  const upload = await pendingUpload(req.params.id, (req as any).user.id);
  await storage.send(new AbortMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: upload.storageKey, UploadId: upload.uploadId })).catch(error => {
    if ((error as { name?: string }).name !== 'NoSuchUpload') throw error;
  });
  await prisma.mediaUpload.delete({ where: { id: upload.id } });
  return ok(res, { success: true });
}

export async function listMedia(req: Request, res: Response) {
  const query = z.object({
    q: z.string().trim().max(160).optional(),
    type: z.enum(['image','video','audio','document','archive']).optional(),
    includeDeleting: z.union([z.string(), z.boolean()]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).strict().parse(req.query);
  const params = getPaginationParams(req.query);
  const where = {
    ...(!(query.includeDeleting === true || query.includeDeleting === 'true') && { deleting: false }),
    ...(query.q && { filename: { contains: query.q, mode: 'insensitive' as const } }),
    ...(query.type && { fileType: query.type }),
  };
  const [media, total] = await Promise.all([
    prisma.mediaLibrary.findMany({ where, skip: getSkip(params), take: params.limit, include: { transcode: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    prisma.mediaLibrary.count({ where }),
  ]);
  return ok(res, await Promise.all(media.map(item => mediaResponse(item, true))), getPaginationMeta(total, params));
}
export async function uploadMedia(req: Request, res: Response) {
  const file = req.file;
  if (!file || !file.size) return badRequest(res, 'Choose a non-empty file to upload');
  if (!mimeExtensions[file.mimetype] || !validSignature(file.buffer, file.mimetype)) return badRequest(res, 'The file contents do not match a supported image or video format');
  if (file.mimetype.startsWith('image/') && file.size > 10 * 1024 * 1024) return res.status(413).json({ success: false, error: 'Images must be 10 MB or smaller' });
  const isPublic = req.body.isPublic === 'true';
  if (isPublic && !file.mimetype.startsWith('image/')) return badRequest(res, 'Only images can be public');
  if (isPublic && !localStorage() && !env.S3_PUBLIC_BASE_URL) return res.status(503).json({ success: false, error: 'Public image delivery is not configured' });
  if (localStorage() && !env.MEDIA_PUBLIC_BASE_URL) return badRequest(res, 'Local file URL is not configured');
  if (!localStorage() && !env.S3_BUCKET) return res.status(503).json({ success: false, error: 'File storage is not configured. Please contact the administrator.' });
  const key = `${localStorage() ? 'local:' : ''}${isPublic ? 'public' : 'media'}/${randomUUID()}.${mimeExtensions[file.mimetype]}`;
  await storeFile(key, file);
  try {
    const media = await prisma.mediaLibrary.create({ data: { filename: file.originalname, storageKey: key, mimeType: file.mimetype, fileType: fileType(file.mimetype), sizeBytes: BigInt(file.size), uploadedBy: (req as any).user.id, isPublic } });
    const withTranscode = await prisma.mediaLibrary.findUniqueOrThrow({ where: { id: media.id }, include: { transcode: true } });
    return created(res, await mediaResponse(withTranscode, true));
  } catch (error) { await removeFile(key).catch(() => {}); throw error; }
}
export async function deleteMedia(req: Request, res: Response) {
  const id = z.string().uuid().parse(req.params.id);
  const media = await prisma.mediaLibrary.findUnique({ where: { id } });
  if (!media) return notFound(res, 'File not found');
  // URLs in existing cover fields are intentionally retained. Do not delete their files.
  const url = mediaDTO(media).url;
  const used = await prisma.$transaction([
    prisma.artistVideo.count({ where: { OR: [{ mediaId: id }, { customCoverUrl: url }] } }),
    prisma.resource.count({ where: { mediaId: id } }), prisma.masterclass.count({ where: { coverImageUrl: url } }),
    prisma.service.count({ where: { coverImageUrl: url } }), prisma.user.count({ where: { avatarUrl: url } }), prisma.testimonial.count({ where: { avatarUrl: url } }),
  ]);
  if (used.some(Boolean)) return res.status(409).json({ success: false, error: 'This file is in use. Remove it from its video, cover or resource before deleting.' });
  await prisma.mediaLibrary.delete({ where: { id } });
  await removeFile(media.storageKey);
  return ok(res, { success: true });
}
