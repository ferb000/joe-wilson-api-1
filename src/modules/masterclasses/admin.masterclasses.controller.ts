import { HttpError } from '../../utils/httpError';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { recordingData } from '../media/media.service';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { ok, created, notFound, badRequest } from '../../utils/response';

// ── Validation schemas ────────────────────────────────────────────────────────

export const createMasterclassSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20000),
  coverImageUrl: z.string().url().optional().or(z.literal('')),
  priceCents: z.number().int().min(0),
  status: z.enum(['draft', 'upcoming', 'active', 'completed']).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  maxEnrollments: z.number().int().positive().nullable().optional(),
  isPublished: z.boolean().optional(),
}).strict();

const updateMasterclassSchema = createMasterclassSchema.partial();

export const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  orderIndex: z.number().int().min(0),
  status: z.enum(['upcoming', 'live', 'completed']).optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  videoMediaId: z.string().uuid().nullable().optional(),
  videoStorageKey: z.string().min(1).max(1024).refine(key => !key.includes("://"), "Use an object key, not a URL").nullable().optional(),
  durationSeconds: z.number().int().positive().optional(),
  liveStreamUrl: z.string().url().optional().or(z.literal('')),
}).strict();

const updateSessionSchema = createSessionSchema.partial();

// ── Controllers ───────────────────────────────────────────────────────────────

export async function listMasterclasses(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  const where = q ? { title: { contains: q, mode: "insensitive" as const } } : {};
  // FIXED: was N+1 — one aggregate query per masterclass.
  // Now uses a single groupBy to fetch all revenue in one query.
  const [masterclasses, revenueByMc] = await Promise.all([
    prisma.masterclass.findMany({
      where, skip: getSkip(params), take: params.limit,
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
    enrollmentsCount: mc._count.enrollments,
    revenueCents: revenueMap.get(mc.id) ?? 0,
    createdAt: mc.createdAt,
  }));

  return ok(res, data, getPaginationMeta(await prisma.masterclass.count({ where }), params));
}

export async function getMasterclass(req: Request, res: Response) {
  const mc = await prisma.masterclass.findUnique({
    where: { id: req.params.id },
    include: { sessions: { orderBy: { orderIndex: 'asc' }, include: { recording: { select: { id: true, filename: true, fileType: true, transcode: { select: { status: true } } } } } }, _count: { select: { sessions: true, enrollments: true } } },
  });
  if (!mc) return notFound(res);
  return ok(res, { ...mc, sessionsCount: mc._count.sessions, enrollmentsCount: mc._count.enrollments });
}

export async function createMasterclass(req: Request, res: Response) {
  // FIXED: was ...req.body directly — mass assignment vulnerability
  const result = createMasterclassSchema.safeParse(req.body);
  if (!result.success) throw result.error;

  if (new Date(result.data.startsAt) >= new Date(result.data.endsAt)) throw new HttpError(400, 'startsAt must be before endsAt');
  if (result.data.isPublished && result.data.priceCents < 50) throw new HttpError(400, "Published masterclasses require a price of at least 50 cents");
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
  if (!result.success) throw result.error;

  const data = {
    ...result.data,
    ...(result.data.startsAt && { startsAt: new Date(result.data.startsAt) }),
    ...(result.data.endsAt && { endsAt: new Date(result.data.endsAt) }),
  };

  const existing = await prisma.masterclass.findUniqueOrThrow({ where: { id: req.params.id } });
  if ((result.data.isPublished ?? existing.isPublished) && (result.data.priceCents ?? existing.priceCents) < 50) throw new HttpError(400, "Published masterclasses require a price of at least 50 cents");
  if (new Date(result.data.startsAt || existing.startsAt) >= new Date(result.data.endsAt || existing.endsAt)) throw new HttpError(400, 'startsAt must be before endsAt');
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
  const params = getPaginationParams(req.query);

  const masterclass = await prisma.masterclass.findUnique({ where: { id } });
  if (!masterclass) return notFound(res);

  const enrollments = await prisma.enrollment.findMany({
    where: { masterclassId: id },
    skip: getSkip(params), take: params.limit,
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true },
      },
      payment: { select: { amountCents: true, status: true, createdAt: true } },
    },
    orderBy: { enrolledAt: 'desc' },
  });

  return ok(res, enrollments, getPaginationMeta(await prisma.enrollment.count({ where: { masterclassId: id } }), params));
}

export async function addSession(req: Request, res: Response) {
  const masterclassId = req.params.id;

  const masterclass = await prisma.masterclass.findUnique({ where: { id: masterclassId } });
  if (!masterclass) return notFound(res, 'Masterclass not found');

  // FIXED: was ...req.body directly — mass assignment vulnerability
  const result = createSessionSchema.safeParse(req.body);
  if (!result.success) throw result.error;

  const data = {
    ...result.data,
    masterclassId,
    ...(result.data.scheduledAt && { scheduledAt: new Date(result.data.scheduledAt) }),
  };

  const session = await prisma.$transaction(async tx => tx.session.create({ data: { ...data, ...await recordingData(tx, result.data) } }));
  return created(res, session);
}

export async function updateSession(req: Request, res: Response) {
  const result = updateSessionSchema.safeParse(req.body);
  if (!result.success) throw result.error;

  const data = {
    ...result.data,
    ...(result.data.scheduledAt && { scheduledAt: new Date(result.data.scheduledAt) }),
  };

  const session = await prisma.$transaction(async tx => tx.session.update({ where: { id: req.params.sessionId }, data: { ...data, ...await recordingData(tx, result.data) } }));
  return ok(res, session);
}

export async function deleteSession(req: Request, res: Response) {
  await prisma.session.delete({ where: { id: req.params.sessionId } });
  return ok(res, { success: true });
}
