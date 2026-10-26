import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { hasActiveAccess } from '../../utils/access';
import { resourceResponse } from '../../utils/mediaResponse';
import { Request, Response } from 'express';
import { AuthRequest } from '../../middleware/authenticate';
import { prisma } from '../../config/database';
import { ok, notFound } from '../../utils/response';

export async function listMasterclasses(req: AuthRequest, res: Response) {
  // FIXED: was req.user!.id — crashes if called without auth (e.g. public landing page).
  // userId is optional now; isEnrolled is false for unauthenticated visitors.
  const userId = req.user?.id;
  const params = getPaginationParams(req.query);

  const [masterclasses, enrollments] = await Promise.all([
    prisma.masterclass.findMany({
      where: { isPublished: true },
      skip: getSkip(params), take: params.limit,
      include: { _count: { select: { sessions: true, enrollments: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    userId
      ? prisma.enrollment.findMany({ where: { userId }, select: { masterclassId: true, accessExpiresAt: true, payment: { select: { status: true } } } })
      : Promise.resolve([]),
  ]);

  const enrolledIds = new Set(enrollments.filter(hasActiveAccess).map((e) => e.masterclassId));

  const data = masterclasses.map((mc) => ({
    id: mc.id,
    title: mc.title,
    description: mc.description,
    coverImageUrl: mc.coverImageUrl,
    priceCents: mc.priceCents,
    status: mc.status,
    startsAt: mc.startsAt,
    endsAt: mc.endsAt,
    sessionsCount: mc._count.sessions,
    enrollmentsCount: mc._count.enrollments,
    isEnrolled: enrolledIds.has(mc.id),
  }));

  return ok(res, data, getPaginationMeta(await prisma.masterclass.count({ where: { isPublished: true } }), params));
}

export async function getMasterclass(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  const { id } = req.params;

  const mc = await prisma.masterclass.findUnique({
    where: { id },
    include: {
      sessions: { orderBy: { orderIndex: 'asc' } },
      resources: { include: { media: true }, orderBy: { orderIndex: 'asc' } },
    },
  });

  if (!mc) return notFound(res);

  const enrollment = userId
    ? await prisma.enrollment.findFirst({ where: { userId, masterclassId: id }, include: { payment: { select: { status: true } } } })
    : null;

  if (!mc.isPublished && !hasActiveAccess(enrollment)) return notFound(res);

  const progressRecords =
    hasActiveAccess(enrollment) && userId
      ? await prisma.sessionProgress.findMany({
          where: { userId, session: { masterclassId: id } },
          select: { sessionId: true, completedAt: true, lastWatchedSeconds: true },
        })
      : [];

  const progressMap = new Map(progressRecords.map((p) => [p.sessionId, p]));

  const sessions = mc.sessions.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    orderIndex: s.orderIndex,
    status: s.status,
    scheduledAt: s.scheduledAt,
    durationSeconds: s.durationSeconds,
    progress: progressMap.get(s.id) ?? null,
  }));

  const progressPct = sessions.length ? Math.round(progressRecords.filter(progress => progress.completedAt).length / sessions.length * 100) : 0;
  return ok(res, { ...mc, sessions, sessionsCount: sessions.length, progressPct, enrollment: hasActiveAccess(enrollment) ? { id: enrollment!.id, userId, masterclassId: id, enrolledAt: enrollment!.enrolledAt, accessExpiresAt: enrollment!.accessExpiresAt, hasAccess: true, progressPct } : null, resources: hasActiveAccess(enrollment) ? await Promise.all(mc.resources.map(resource => resourceResponse(resource, userId))) : [], isEnrolled: hasActiveAccess(enrollment) });
}

export async function getMasterclassSessions(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const mc = await prisma.masterclass.findUnique({ where: { id, isPublished: true }, select: { id: true } });
  if (!mc) return notFound(res);
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_masterclassId: { userId: req.user!.id, masterclassId: id } }, include: { payment: { select: { status: true } } } });
  const sessions = await prisma.session.findMany({
    where: { masterclassId: id },
    orderBy: { orderIndex: 'asc' },
  });
  return ok(res, sessions.map(({ videoStorageKey: _key, videoMediaId: _mediaId, liveStreamUrl, ...session }) => ({ ...session, ...(hasActiveAccess(enrollment) && { liveStreamUrl }) })));
}
