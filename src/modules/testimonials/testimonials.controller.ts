import { z } from 'zod';
import { createSchema, updateSchema } from './testimonials.schema';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { ok, created } from '../../utils/response';

export async function listTestimonials(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const { featured } = z.object({ featured: z.enum(['true','false']).optional() }).parse(req.query);
  const testimonials = await prisma.testimonial.findMany({
    where: featured === 'true' ? { isFeatured: true } : undefined,
    skip: getSkip(params), take: params.limit,
    orderBy: { orderIndex: 'asc' },
  });
  return ok(res, testimonials, getPaginationMeta(await prisma.testimonial.count({ where: featured === 'true' ? { isFeatured: true } : undefined }), params));
}

export async function createTestimonial(req: Request, res: Response) {
  const testimonial = await prisma.testimonial.create({ data: createSchema.parse(req.body) });
  return created(res, testimonial);
}

export async function updateTestimonial(req: Request, res: Response) {
  req.body = updateSchema.parse(req.body);
  const testimonial = await prisma.testimonial.update({
    where: { id: req.params.id },
    data: req.body,
  });
  return ok(res, testimonial);
}

export async function deleteTestimonial(req: Request, res: Response) {
  await prisma.testimonial.delete({ where: { id: req.params.id } });
  return ok(res, { success: true });
}
