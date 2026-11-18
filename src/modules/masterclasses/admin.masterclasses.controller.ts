import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { ok, created, notFound, badRequest } from '../../utils/response';

// ── Validation schemas ────────────────────────────────────────────────────────

const createMasterclassSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  coverImageUrl: z.string().url().optional().or(z.literal('')),
  priceCents: z.number().int().min(0),
  status: z.enum(['draft', 'upcoming', 'active', 'completed']).optional(),
  startsAt: z.string().min(1, 'startsAt is required'),
  endsAt: z.string().min(1, 'endsAt is required'),
  maxEnrollments: z.number().int().positive().optional(),
  isPublished: z.boolean().optional(),
});

const updateMasterclassSchema = createMasterclassSchema.partial();

const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  orderIndex: z.number().int().min(0),
  status: z.enum(['upcoming', 'live', 'completed']).optional(),
  scheduledAt: z.string().optional(),
  muxAssetId: z.string().optional(),
  muxPlaybackId: z.string().optional(),
  durationSeconds: z.number().int().positive().optional(),
  liveStreamUrl: z.string().url().optional().or(z.literal('')),
});

const updateSessionSchema = createSessionSchema.partial();

// ── Controllers ───────────────────────────────────────────────────────────────

export async function listMasterclasses(req: Request, res: Response) {
  // FIXED: was N+1 — one aggregate query per masterclass.
  // Now uses a single groupBy to fetch all revenue in one query.
  const [masterclasses, revenueByMc] = await Promise.all([
    prisma.masterclass.findMany({
      include: { _count: { select: { sessions: true, enrollments: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.groupBy({
      by: ['masterclassId'],
      where: { status: 'succeeded' },
      _sum: { amountCents: true },
    }),
  ]);

  const revenueMap = new Map(
    revenueByMc.map((r) => [r.masterclassId, r._sum.amountCents ?? 0])
  );

  const data = masterclasses.map((mc) => ({
    id: mc.id,
    title: mc.title,
    description: mc.description,
    coverImageUrl: mc.coverImageUrl,
    status: mc.status,
    priceCents: mc.priceCents,
    isPublished: mc.isPublished,
    startsAt: mc.startsAt,
    endsAt: mc.endsAt,
    sessionsCount: mc._count.sessions,
    enrolledCount: mc._count.enrollments,
    revenueCents: revenueMap.get(mc.id) ?? 0,
    createdAt: mc.createdAt,
  }));

  return ok(res, data);
}

export async function getMasterclass(req: Request, res: Response) {
  const id = z.string().uuid().parse(req.params.id);
  const item = await prisma.masterclass.findUnique({ where: { id }, include: { sessions: { orderBy: { orderIndex: 'asc' } } } });
  return item ? ok(res, item) : notFound(res, 'Masterclass not found');
}

export async function createMasterclass(req: Request, res: Response) {
  // FIXED: was ...req.body directly — mass assignment vulnerability
  const result = createMasterclassSchema.safeParse(req.body);
  if (!result.success) return badRequest(res, JSON.stringify(result.error.format()));

  const data = {
    ...result.data,
    startsAt: new Date(result.data.startsAt),
    endsAt: new Date(result.data.endsAt),
  };

  const masterclass = await prisma.masterclass.create({ data });
  return created(res, masterclass);
}

export async function updateMasterclass(req: Request, res: Response) {
  const result = updateMasterclassSchema.safeParse(req.body);
  if (!result.success) return badRequest(res, JSON.stringify(result.error.format()));

  const data = {
    ...result.data,
    ...(result.data.startsAt && { startsAt: new Date(result.data.startsAt) }),
    ...(result.data.endsAt && { endsAt: new Date(result.data.endsAt) }),
  };

  const masterclass = await prisma.masterclass.update({
    where: { id: req.params.id },
    data,
  });
  return ok(res, masterclass);
}

export async function deleteMasterclass(req: Request, res: Response) {
  // Soft delete — unpublish rather than destroy enrolled users' access
  const masterclass = await prisma.masterclass.update({
    where: { id: req.params.id },
    data: { isPublished: false, status: 'completed' },
  });
  return ok(res, masterclass);
}

export async function getMasterclassEnrollments(req: Request, res: Response) {
  const { id } = req.params;

  const masterclass = await prisma.masterclass.findUnique({ where: { id } });
  if (!masterclass) return notFound(res);

  const enrollments = await prisma.enrollment.findMany({
    where: { masterclassId: id },
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true },
      },
      payment: { select: { amountCents: true, status: true, createdAt: true } },
    },
    orderBy: { enrolledAt: 'desc' },
  });

  return ok(res, enrollments);
}

export async function addSession(req: Request, res: Response) {
  const masterclassId = req.params.id;

  const masterclass = await prisma.masterclass.findUnique({ where: { id: masterclassId } });
  if (!masterclass) return notFound(res, 'Masterclass not found');

  // FIXED: was ...req.body directly — mass assignment vulnerability
  const result = createSessionSchema.safeParse(req.body);
  if (!result.success) return badRequest(res, JSON.stringify(result.error.format()));

  const data = {
    ...result.data,
    masterclassId,
    ...(result.data.scheduledAt && { scheduledAt: new Date(result.data.scheduledAt) }),
  };

  const session = await prisma.session.create({ data });
  return created(res, session);
}

export async function updateSession(req: Request, res: Response) {
  const result = updateSessionSchema.safeParse(req.body);
  if (!result.success) return badRequest(res, JSON.stringify(result.error.format()));

  const data = {
    ...result.data,
    ...(result.data.scheduledAt && { scheduledAt: new Date(result.data.scheduledAt) }),
  };

  const session = await prisma.session.update({
    where: { id: req.params.sessionId },
    data,
  });
  return ok(res, session);
}

export async function deleteSession(req: Request, res: Response) {
  await prisma.session.delete({ where: { id: req.params.sessionId } });
  return ok(res, { success: true });
}
