
import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { ok } from '../../utils/response';

export async function getDashboard(req: Request, res: Response) {
  const [
    totalUsers,
    totalMasterclasses,
    totalEnrollments,
    revenueResult,
    refundedResult,
    failedPayments,
    recentPayments,
    recentInquiries,
    activeMasterclasses,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'member' } }),
    prisma.masterclass.count({ where: { isPublished: true } }),
    prisma.enrollment.count(),
    prisma.payment.aggregate({ where: { status: 'succeeded' }, _sum: { amountCents: true } }),
    prisma.payment.aggregate({ where: { status: 'refunded' }, _sum: { amountCents: true } }),
    prisma.payment.count({ where: { status: 'failed' } }),
    prisma.payment.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } },
        masterclass: { select: { title: true } },
      },
    }),
    prisma.inquiry.findMany({
      take: 5,
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.masterclass.findMany({
      where: { status: 'active', isPublished: true },
      include: { _count: { select: { enrollments: true, sessions: true } } },
    }),
  ]);

  return ok(res, {
    stats: {
      totalUsers,
      totalMasterclasses,
      totalEnrollments,
      netRevenueCents: revenueResult._sum.amountCents || 0,
      refundedCents: refundedResult._sum.amountCents || 0,
      failedPayments,
    },
    recentPayments,
    recentInquiries,
    activeMasterclasses: activeMasterclasses.map((mc) => ({
      ...mc,
      enrollmentsCount: mc._count.enrollments,
      sessionsCount: mc._count.sessions,
    })),
  });
}
