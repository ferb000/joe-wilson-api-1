import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { lockMedia, mediaResponse } from '../media/media.service';
import { ok, created } from '../../utils/response';
import { HttpError } from '../../utils/httpError';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
const fields = z.object({ mediaId: z.string().uuid(), label: z.string().trim().min(1).max(255), orderIndex: z.number().int().nonnegative(), sessionId: z.string().uuid().nullable().optional(), masterclassId: z.string().uuid().nullable().optional() }).strict();
function oneParent(input: { sessionId?: string | null; masterclassId?: string | null }) { return !!input.sessionId !== !!input.masterclassId; }
export async function listResources(req: Request, res: Response) {
  const where = z.object({ sessionId: z.string().uuid().optional(), masterclassId: z.string().uuid().optional() }).refine(oneParent, 'Provide exactly one parent').parse(req.query);
  const params = getPaginationParams(req.query);
  const [rows, total] = await Promise.all([prisma.resource.findMany({ where, skip: getSkip(params), take: params.limit, include: { media: true }, orderBy: { orderIndex: 'asc' } }), prisma.resource.count({ where })]);
  return ok(res, await Promise.all(rows.map(async row => ({ ...row, media: await mediaResponse(row.media, true) }))), getPaginationMeta(total, params));
}
export async function createResource(req: Request, res: Response) {
  const data = fields.refine(oneParent, 'Provide exactly one parent').parse(req.body);
  const row = await prisma.$transaction(async tx => { await lockMedia(tx, data.mediaId); return tx.resource.create({ data }); });
  return created(res, row);
}
export async function updateResource(req: Request, res: Response) {
  const data = fields.partial().parse(req.body);
  const row = await prisma.$transaction(async tx => {
    const existing = await tx.resource.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Resource not found');
    if (!oneParent({ ...existing, ...data })) throw new HttpError(400, 'Provide exactly one parent');
    await lockMedia(tx, data.mediaId || existing.mediaId);
    return tx.resource.update({ where: { id: existing.id }, data });
  });
  return ok(res, row);
}
export async function deleteResource(req: Request, res: Response) {
  await prisma.resource.delete({ where: { id: req.params.id } });
  return ok(res, { success: true });
}
