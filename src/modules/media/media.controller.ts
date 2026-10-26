import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, Part } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { Prisma, TranscodeStatus } from '@prisma/client';
import { s3 } from '../../config/s3';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { AuthRequest } from '../../middleware/authenticate';
import { ok, created } from '../../utils/response';
import { HttpError } from '../../utils/httpError';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { allowedMimeTypes, fileType, mediaResponse, lockMedia } from './media.service';
import { deleteTranscodePrefix } from './transcoding/storage';
import { logger } from '../../config/logger';
export const PART_SIZE = 10 * 1024 * 1024;
export const uploadSchema = z.object({ filename: z.string().min(1).max(255), mimeType: z.string().refine(m => allowedMimeTypes.includes(m), 'Unsupported file type'), sizeBytes: z.number().int().positive().max(env.S3_MAX_UPLOAD_BYTES), isPublic: z.boolean().default(false) }).strict().refine(d => !d.isPublic || d.mimeType.startsWith('image/'), 'Only images can be public');
function bucket() { if (!env.S3_BUCKET) throw new HttpError(503, 'File storage is not configured'); return env.S3_BUCKET; }
function key(filename: string, isPublic: boolean) { if (isPublic && !env.S3_PUBLIC_BASE_URL) throw new HttpError(503, 'Public media delivery is not configured'); return (isPublic ? 'public/' : 'media/') + randomUUID() + '/' + filename.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase(); }
export async function listMedia(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const includeDeleting = z.enum(['true','false']).optional().parse(req.query.includeDeleting) === 'true';
  const where: Prisma.MediaLibraryWhereInput = { ...(includeDeleting ? {} : { deleting: false }), ...(req.query.q ? { filename: { contains: String(req.query.q), mode: 'insensitive' } } : {}), ...(req.query.type ? { fileType: z.enum(['image','audio','video','document','archive']).parse(req.query.type) } : {}) };
  const [media, total] = await Promise.all([prisma.mediaLibrary.findMany({ where, skip: getSkip(params), take: params.limit, include: { transcode: true }, orderBy: { createdAt: 'desc' } }), prisma.mediaLibrary.count({ where })]);
  return ok(res, await Promise.all(media.map(m => mediaResponse(m, true))), getPaginationMeta(total, params));
}
export async function uploadMedia(req: AuthRequest, res: Response) {
  if (!req.file) throw new HttpError(400, 'No file provided');
  const isPublic = req.body.isPublic === 'true' || req.body.isPublic === true;
  const input = uploadSchema.parse({ filename: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size, isPublic });
  const storageKey = key(input.filename, isPublic);
  await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: storageKey, Body: req.file.buffer, ContentType: input.mimeType }));
  let media;
  try { media = await prisma.mediaLibrary.create({ data: { filename: input.filename, storageKey, mimeType: input.mimeType, fileType: fileType(input.mimeType), sizeBytes: BigInt(input.sizeBytes), isPublic, uploadedBy: req.user!.id, ...(input.mimeType.startsWith('video/') && { transcode: { create: {} } }) }, include: { transcode: true } }); }
  catch (error) { await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageKey })).catch(() => logger.error({ storageKey }, 'Orphaned upload requires cleanup')); throw error; }
  return created(res, await mediaResponse(media, true));
}
export async function startUpload(req: AuthRequest, res: Response) {
  const input = uploadSchema.parse(req.body);
  const storageKey = key(input.filename, input.isPublic);
  const upload = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: storageKey, ContentType: input.mimeType }));
  if (!upload.UploadId) throw new HttpError(502, 'Storage did not create an upload');
  let record;
  try { record = await prisma.mediaUpload.create({ data: { storageKey, uploadId: upload.UploadId, filename: input.filename, mimeType: input.mimeType, sizeBytes: BigInt(input.sizeBytes), uploadedBy: req.user!.id, isPublic: input.isPublic, expiresAt: new Date(Date.now() + 86400000) } }); }
  catch (error) { await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: storageKey, UploadId: upload.UploadId })).catch(() => {}); throw error; }
  return created(res, { id: record.id, partSize: PART_SIZE, partsCount: Math.ceil(input.sizeBytes / PART_SIZE), expiresAt: record.expiresAt });
}
async function pendingUpload(req: AuthRequest) {
  const upload = await prisma.mediaUpload.findFirst({ where: { id: req.params.id, uploadedBy: req.user!.id } });
  if (!upload) throw new HttpError(404, 'Upload not found');
  if (upload.expiresAt <= new Date()) throw new HttpError(410, 'Upload expired; abort it and start again');
  return upload;
}
export async function uploadPart(req: AuthRequest, res: Response) {
  const upload = await pendingUpload(req);
  if (upload.status !== 'uploading') throw new HttpError(409, 'Upload is being finalized');
  const { partNumber } = z.object({ partNumber: z.number().int().min(1).max(Math.ceil(Number(upload.sizeBytes) / PART_SIZE)) }).strict().parse(req.body);
  const url = await getSignedUrl(s3, new UploadPartCommand({ Bucket: bucket(), Key: upload.storageKey, UploadId: upload.uploadId, PartNumber: partNumber }), { expiresIn: 900 });
  return ok(res, { url, expiresIn: 900 });
}
export function verifyUploadParts(parts: Part[], expectedSize: number) {
  parts.sort((a, b) => (a.PartNumber || 0) - (b.PartNumber || 0));
  if (parts.length !== Math.ceil(expectedSize / PART_SIZE) || parts.some((p, i) => p.PartNumber !== i + 1 || !p.ETag || p.Size !== Math.min(PART_SIZE, expectedSize - i * PART_SIZE))) throw new HttpError(400, 'Upload parts do not match the declared file size');
}
export async function completeUpload(req: AuthRequest, res: Response) {
  const upload = await pendingUpload(req);
  const reserved = await prisma.mediaUpload.updateMany({ where: { id: upload.id, OR: [{ status: 'uploading' }, { status: 'finalizing', updatedAt: { lt: new Date(Date.now() - 300000) } }] }, data: { status: 'finalizing' } });
  if (reserved.count !== 1) throw new HttpError(409, 'Upload is being finalized');
  try {
    let object;
    try { object = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: upload.storageKey })); }
    catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error; }
    if (!object) {
      const parts: Part[] = []; let marker: string | undefined;
      do { const page = await s3.send(new ListPartsCommand({ Bucket: bucket(), Key: upload.storageKey, UploadId: upload.uploadId, PartNumberMarker: marker })); parts.push(...(page.Parts || [])); marker = page.IsTruncated ? page.NextPartNumberMarker : undefined; } while (marker);
      verifyUploadParts(parts, Number(upload.sizeBytes));
      await s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket(), Key: upload.storageKey, UploadId: upload.uploadId, MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag })) } }));
      object = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: upload.storageKey }));
    }
    if (object.ContentLength !== Number(upload.sizeBytes) || object.ContentType !== upload.mimeType) throw new HttpError(400, 'Stored object does not match the upload');
    const media = await prisma.$transaction(async tx => { const media = await tx.mediaLibrary.create({ data: { filename: upload.filename, storageKey: upload.storageKey, mimeType: upload.mimeType, fileType: fileType(upload.mimeType), sizeBytes: upload.sizeBytes, uploadedBy: upload.uploadedBy, isPublic: upload.isPublic, ...(upload.mimeType.startsWith('video/') && { transcode: { create: {} } }) }, include: { transcode: true } }); await tx.mediaUpload.delete({ where: { id: upload.id } }); return media; });
    return created(res, await mediaResponse(media, true));
  } catch (error) { await prisma.mediaUpload.updateMany({ where: { id: upload.id }, data: { status: 'uploading' } }); throw error; }
}
export async function abortUpload(req: AuthRequest, res: Response) {
  const upload = await prisma.mediaUpload.findFirst({ where: { id: req.params.id, uploadedBy: req.user!.id } });
  if (!upload) throw new HttpError(404, 'Upload not found');
  const reserved = await prisma.mediaUpload.updateMany({ where: { id: upload.id, OR: [{ status: 'uploading' }, { status: 'aborting' }, { status: 'finalizing', updatedAt: { lt: new Date(Date.now() - 300000) } }] }, data: { status: 'aborting' } });
  if (reserved.count !== 1) throw new HttpError(409, 'Upload is being finalized');
  await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: upload.storageKey, UploadId: upload.uploadId })).catch(error => { if (error.name !== 'NoSuchUpload') throw error; });
  await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: upload.storageKey }));
  await prisma.mediaUpload.delete({ where: { id: upload.id } });
  return ok(res, { success: true });
}
export async function importMedia(req: AuthRequest, res: Response) {
  const { storageKey } = z.object({ storageKey: z.string().min(1).max(1024).refine(key => !key.includes('://') && !key.startsWith('public/'), 'Import private object keys only') }).strict().parse(req.body);
  const object = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: storageKey }));
  const input = uploadSchema.parse({ filename: storageKey.split('/').pop(), mimeType: object.ContentType, sizeBytes: object.ContentLength });
  const media = await prisma.mediaLibrary.create({ data: { ...input, storageKey, fileType: fileType(input.mimeType), sizeBytes: BigInt(input.sizeBytes), uploadedBy: req.user!.id, ...(input.mimeType.startsWith('video/') && { transcode: { create: {} } }) }, include: { transcode: true } });
  return created(res, await mediaResponse(media, true));
}
export async function deleteMedia(req: AuthRequest, res: Response) {
  const media = await prisma.$transaction(async tx => {
    const media = await lockMedia(tx, req.params.id, true);
    if (await tx.resource.count({ where: { mediaId: media.id } }) || await tx.session.count({ where: { OR: [{ videoMediaId: media.id }, { videoStorageKey: media.storageKey }] } })) throw new HttpError(409, 'Detach this media from sessions and resources first');
    await tx.$queryRaw(Prisma.sql`SELECT id FROM video_transcodes WHERE "mediaId" = ${media.id} FOR UPDATE`);
    const transcode = await tx.videoTranscode.findUnique({ where: { mediaId: media.id } });
    if (transcode?.status === 'processing') throw new HttpError(409, 'Wait for video processing to finish before deleting');
    if (transcode) await tx.videoTranscode.update({ where: { id: transcode.id }, data: { status: 'failed', leaseToken: null, lockedUntil: null } });
    return tx.mediaLibrary.update({ where: { id: media.id }, data: { deleting: true }, include: { transcode: true } });
  });
  // A failed storage deletion leaves a tombstone for a safe retry; no new attachments can use it.
  if (media.transcode?.outputPrefix) await deleteTranscodePrefix(media.transcode.outputPrefix);
  await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: media.storageKey }));
  await prisma.mediaLibrary.delete({ where: { id: media.id } });
  return ok(res, { success: true });
}

export async function getTranscode(req: Request, res: Response) {
  const media = await prisma.mediaLibrary.findUnique({ where: { id: req.params.id }, include: { transcode: true } });
  if (!media || media.deleting || media.fileType !== 'video') throw new HttpError(404, 'Video not found');
  const job = media.transcode;
  return ok(res, job ? { status: job.status, attempts: job.attempts, durationSeconds: job.durationSeconds, renditions: job.renditions, errorCode: job.errorCode } : { status: 'not_queued' });
}

export async function queueTranscode(req: Request, res: Response) {
  z.object({}).strict().parse(req.body || {});
  const job = await prisma.$transaction(async tx => {
    const media = await lockMedia(tx, req.params.id);
    if (media.fileType !== 'video' || media.isPublic) throw new HttpError(400, 'Only private videos can be transcoded');
    const job = await tx.videoTranscode.upsert({ where: { mediaId: media.id }, create: { mediaId: media.id }, update: {} });
    if (job.status === 'ready' || job.status === 'processing') throw new HttpError(409, 'Video is already ready or processing');
    if (job.status === 'queued') return job;
    return tx.videoTranscode.update({ where: { id: job.id }, data: { status: TranscodeStatus.queued, attempts: 0, availableAt: new Date(), errorCode: null, leaseToken: null, lockedUntil: null } });
  });
  return ok(res, { status: job.status });
}
