import { z } from 'zod';
import { HttpError } from '../../utils/httpError';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { ok, created, notFound } from '../../utils/response';
import { sendQuoteNotificationEmail } from '../../utils/email';

export async function submitQuote(req: Request, res: Response) {
  const data = { ...req.body, eventDate: req.body.eventDate ? new Date(req.body.eventDate) : undefined };
  const quote = await prisma.$transaction(async tx => {
    const service = await tx.service.findUnique({ where: { id: req.body.serviceId, isPublished: true } });
    if (!service) throw new HttpError(404, 'Service not found');
    const quote = await tx.quoteRequest.create({ data });
    await sendQuoteNotificationEmail(quote.clientName, quote.clientEmail, service.title, tx);
    return quote;
  });

  return created(res, { id: quote.id });
}

export async function listQuotes(req: Request, res: Response) {
  const params = getPaginationParams(req.query);
  const { status } = z.object({ status: z.enum(['new','reviewing','quoted','booked','closed']).optional() }).parse(req.query);
  const quotes = await prisma.quoteRequest.findMany({
    where: status ? { status: status as 'new' | 'reviewing' | 'quoted' | 'booked' | 'closed' } : undefined,
    include: { service: { select: { id: true, title: true } } },
    skip: getSkip(params), take: params.limit,
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, quotes, getPaginationMeta(await prisma.quoteRequest.count({ where: status ? { status } : undefined }), params));
}

export async function getQuote(req: Request, res: Response) {
  const quote = await prisma.quoteRequest.findUnique({
    where: { id: req.params.id },
    include: { service: true },
  });
  if (!quote) return notFound(res);
  return ok(res, quote);
}

export async function updateQuoteStatus(req: Request, res: Response) {
  const quote = await prisma.quoteRequest.update({
    where: { id: req.params.id },
    data: { status: req.body.status, adminNotes: req.body.adminNotes },
  });
  return ok(res, quote);
}
