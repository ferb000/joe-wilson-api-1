import { z } from 'zod';
import { csvCell } from '../../utils/csv';
import { dateRange } from '../../utils/dateRange';
import { Request, Response } from 'express';
import { getStripe } from '../../config/stripe';
import { HttpError } from '../../utils/httpError';
import { prisma } from '../../config/database';
import { ok, notFound, badRequest } from '../../utils/response';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';

export async function listPayments(req: Request, res: Response) {
  const { from, to, status } = req.query;
  const params = getPaginationParams(req.query as { page?: string; limit?: string });

  const where: Record<string, unknown> = {};
  if (status) where.status = z.enum(['pending','succeeded','failed','refunded']).parse(status);
  const range = dateRange(req.query);
  if (range) where.createdAt = range;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } },
        masterclass: { select: { id: true, title: true } },
      },
      skip: getSkip(params),
      take: params.limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payment.count({ where }),
  ]);

  // Aggregate stats
  const [netResult, refundedResult, failedCount] = await Promise.all([
    prisma.payment.aggregate({ where: { ...where, status: 'succeeded' }, _sum: { amountCents: true } }),
    prisma.payment.aggregate({ where: { ...where, status: 'refunded' }, _sum: { amountCents: true } }),
    prisma.payment.count({ where: { ...where, status: 'failed' } }),
  ]);

  const stats = {
    netRevenueCents: netResult._sum.amountCents || 0,
    refundedCents: refundedResult._sum.amountCents || 0,
    failedCount,
  };

  return ok(res, { payments, stats }, getPaginationMeta(total, params));
}

export async function refundPayment(req: Request, res: Response) {
  const stripe = getStripe();
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return notFound(res);
  if (payment.status !== 'succeeded' || !payment.gatewayReference) throw new HttpError(409, 'Only confirmed provider payments can be refunded');
  const refund = await stripe.refunds.create({ payment_intent: payment.gatewayReference, amount: payment.amountCents }, { idempotencyKey: 'refund:' + payment.id });
  // The signed charge.refunded webhook owns the final database/access transition.
  return ok(res, { message: 'Refund requested', refundId: refund.id, status: refund.status });
}

export async function exportCsv(req: Request, res: Response) {
  const { from, to } = req.query;

  const where: Record<string, unknown> = {};
  const range = dateRange(req.query);
  if (range) where.createdAt = range;

  const payments = await prisma.payment.findMany({
    where,
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
      masterclass: { select: { title: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const headers = ['Date', 'User', 'Email', 'Masterclass', 'Amount (USD)', 'Status'];
  const rows = payments.map((p) => [
    p.createdAt.toISOString().split('T')[0],
    `${p.user.firstName} ${p.user.lastName}`,
    p.user.email,
    p.masterclass.title,
    (p.amountCents / 100).toFixed(2),
    p.status,
  ]);

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="payments-export-${Date.now()}.csv"`);
  return res.send(csv);
}
