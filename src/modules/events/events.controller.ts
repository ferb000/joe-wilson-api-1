import { createSchema, updateSchema } from './events.schema';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { ok, created } from '../../utils/response';

export async function listEvents(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const events = await prisma.event.findMany({
    where: { isPublished: true, eventDate: { gte: new Date() } },
    skip: getSkip(params), take: params.limit,
    orderBy: { eventDate: 'asc' },
  });
  return ok(res, events, getPaginationMeta(await prisma.event.count({ where: { isPublished: true, eventDate: { gte: new Date() } } }), params));
}

export async function createEvent(req: Request, res: Response) {
  req.body = createSchema.parse(req.body);
  const data = { ...req.body, eventDate: new Date(req.body.eventDate) };
  const event = await prisma.event.create({ data });
  return created(res, event);
}

export async function updateEvent(req: Request, res: Response) {
  req.body = updateSchema.parse(req.body);
  const data = req.body.eventDate ? { ...req.body, eventDate: new Date(req.body.eventDate) } : req.body;
  const event = await prisma.event.update({ where: { id: req.params.id }, data });
  return ok(res, event);
}

export async function deleteEvent(req: Request, res: Response) {
  await prisma.event.delete({ where: { id: req.params.id } });
  return ok(res, { success: true });
}

export async function listAll(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const [items, total] = await Promise.all([prisma.event.findMany({ skip: getSkip(params), take: params.limit, orderBy: { eventDate: 'desc' } }), prisma.event.count()]);
  return ok(res, items, getPaginationMeta(total, params));
}
