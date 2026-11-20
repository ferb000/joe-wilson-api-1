import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { ok, created, badRequest, notFound } from '../../utils/response';
import { getPaginationMeta, getPaginationParams, getSkip } from '../../utils/pagination';
import { localStorage, mediaDTO, mediaResponse, mimeExtensions, fileType, validSignature, storeFile, removeFile } from './media.service';

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
