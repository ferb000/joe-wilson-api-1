import { createSchema, updateSchema } from './services.schema';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { ok, created, notFound } from '../../utils/response';

export async function listServices(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const services = await prisma.service.findMany({
    where: { isPublished: true },
    skip: getSkip(params), take: params.limit,
    orderBy: { orderIndex: 'asc' },
  });
  return ok(res, services, getPaginationMeta(await prisma.service.count({ where: { isPublished: true } }), params));
}

export async function getService(req: Request, res: Response) {
  const service = await prisma.service.findUnique({ where: { slug: req.params.slug, isPublished: true } });
  if (!service) return notFound(res);

  const related = await prisma.service.findMany({
    where: { isPublished: true, id: { not: service.id } },
    take: 3,
    orderBy: { orderIndex: 'asc' },
    select: { id: true, slug: true, title: true, coverImageUrl: true },
  });

  return ok(res, { service, relatedServices: related });
}

export async function createService(req: Request, res: Response) {
  const service = await prisma.service.create({ data: createSchema.parse(req.body) });
  return created(res, service);
}

export async function updateService(req: Request, res: Response) {
  req.body = updateSchema.parse(req.body);
  const service = await prisma.service.update({ where: { id: req.params.id }, data: req.body });
  return ok(res, service);
}

export async function deleteService(req: Request, res: Response) {
  await prisma.service.delete({ where: { id: req.params.id } });
  return ok(res, { success: true });
}

export async function listAll(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const [items, total] = await Promise.all([prisma.service.findMany({ skip: getSkip(params), take: params.limit, orderBy: { orderIndex: 'asc' } }), prisma.service.count()]);
  return ok(res, items, getPaginationMeta(total, params));
}
