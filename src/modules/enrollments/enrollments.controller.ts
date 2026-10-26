
import { hasActiveAccess } from '../../utils/access';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { Request, Response } from 'express';
import { AuthRequest } from '../../middleware/authenticate';
import { prisma } from '../../config/database';
import { ok, forbidden } from '../../utils/response';

export async function getMyEnrollments(req: AuthRequest, res: Response) {
  const userId = req.user!.id;
  const params = getPaginationParams(req.query);

  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    skip: getSkip(params), take: params.limit,
    include: {
      payment: { select: { status: true } },
      masterclass: {
        include: { _count: { select: { sessions: true } } },
      },
    },
    orderBy: { enrolledAt: 'desc' },
  });

  if (enrollments.length === 0) return ok(res, [], getPaginationMeta(await prisma.enrollment.count({ where: { userId } }), params));

  // FIXED: was a separate prisma.sessionProgress.count() inside Promise.all() per enrollment.
  // That is an N+1 query. Now we fetch all progress counts in a single grouped query.
  const masterclassIds = enrollments.map((e) => e.masterclassId);



  // Fetch all completed session→masterclass mappings in one query
  const completedSessions = await prisma.sessionProgress.findMany({
    where: {
      userId,
      completedAt: { not: null },
      session: { masterclassId: { in: masterclassIds } },
    },
    include: { session: { select: { masterclassId: true } } },
  });

  // Build a count map: masterclassId → number of completed sessions
  const completedCountMap = new Map<string, number>();
  for (const sp of completedSessions) {
    const mcId = sp.session.masterclassId;
    completedCountMap.set(mcId, (completedCountMap.get(mcId) ?? 0) + 1);
  }

  const data = enrollments.map((enrollment) => {
    const totalSessions = enrollment.masterclass._count.sessions;
    const completedSessions = completedCountMap.get(enrollment.masterclassId) ?? 0;
    const progressPct =
      totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    return {
      id: enrollment.id,
      userId: enrollment.userId,
      masterclassId: enrollment.masterclassId,
      enrolledAt: enrollment.enrolledAt,
      accessExpiresAt: enrollment.accessExpiresAt,
      hasAccess: hasActiveAccess(enrollment),
      masterclass: {
        id: enrollment.masterclass.id,
        title: enrollment.masterclass.title,
        description: enrollment.masterclass.description,
        priceCents: enrollment.masterclass.priceCents,
        startsAt: enrollment.masterclass.startsAt,
        endsAt: enrollment.masterclass.endsAt,
        coverImageUrl: enrollment.masterclass.coverImageUrl,
        status: enrollment.masterclass.status,
        sessionsCount: totalSessions,
      },
      sessionsCompleted: completedSessions,
      progressPct,
    };
  });

  return ok(res, data, getPaginationMeta(await prisma.enrollment.count({ where: { userId } }), params));
}

export async function getMasterclassEnrollments(req: Request, res: Response) {
  const { masterclassId } = req.params;
  const params = getPaginationParams(req.query);

  const enrollments = await prisma.enrollment.findMany({
    where: { masterclassId },
    skip: getSkip(params), take: params.limit,
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true },
      },
      payment: { select: { id: true, amountCents: true, status: true, createdAt: true } },
    },
    orderBy: { enrolledAt: 'desc' },
  });

  return ok(res, enrollments, getPaginationMeta(await prisma.enrollment.count({ where: { masterclassId } }), params));
}
