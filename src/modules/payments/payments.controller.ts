import { Request, Response } from 'express';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/authenticate';
import { prisma } from '../../config/database';
import { getStripe } from '../../config/stripe';
import { env } from '../../config/env';
import { HttpError } from '../../utils/httpError';
import { ok } from '../../utils/response';
import { sendPaymentReceiptEmail } from '../../utils/email';
import { getPaginationParams, getPaginationMeta, getSkip } from '../../utils/pagination';
import { z } from 'zod';
export function validateCheckoutRedirect(value: string) {
  const url = new URL(value);
  const origins = env.FRONTEND_URLS.split(',').map(origin => origin.trim());
  if (!origins.includes(url.origin) || url.username || url.password || url.hash) throw new HttpError(400, 'Checkout return URL must use an approved frontend origin');
  return url;
}
export const checkoutSchema = z.object({ masterclassId: z.string().uuid(), successUrl: z.string().url().max(2048).optional(), cancelUrl: z.string().url().max(2048).optional() }).strict();

export async function createCheckout(req: AuthRequest, res: Response) {
  const stripe = getStripe();
  const input = checkoutSchema.parse(req.body);
  const { masterclassId } = input;
  const origin = env.FRONTEND_URLS.split(',')[0].trim();
  const success = validateCheckoutRedirect(input.successUrl || origin + '/checkout?success=true');
  const cancel = validateCheckoutRedirect(input.cancelUrl || origin + '/checkout');
  success.searchParams.set('masterclassId', masterclassId);
  success.searchParams.set('success', 'true');
  success.searchParams.delete('session_id');
  cancel.searchParams.set('masterclassId', masterclassId);
  const successUrl = success.toString() + '&session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = cancel.toString();
  const userId = req.user!.id;
  const payment = await prisma.$transaction(async tx => {
    // Serialize reservations for this class to prevent concurrent overbooking.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM masterclasses WHERE id = ${masterclassId} FOR UPDATE`);
    const mc = await tx.masterclass.findUnique({ where: { id: masterclassId } });
    if (!mc || !mc.isPublished) throw new HttpError(404, 'Masterclass not found');
    if (mc.status === 'draft' || mc.status === 'completed') throw new HttpError(409, 'Enrollment is closed');
    if (mc.priceCents < 50) throw new HttpError(400, 'Paid checkout requires a price of at least 50 USD cents');
    if (await tx.enrollment.findUnique({ where: { userId_masterclassId: { userId, masterclassId } } })) throw new HttpError(409, 'You are already enrolled');
    const existing = await tx.payment.findFirst({ where: { userId, masterclassId, status: 'pending' }, orderBy: { createdAt: 'desc' } });
    if (existing) return existing;
    if (mc.maxEnrollments) {
      const occupied = await tx.enrollment.count({ where: { masterclassId } }) + await tx.payment.count({ where: { masterclassId, status: 'pending' } });
      if (occupied >= mc.maxEnrollments) throw new HttpError(409, 'Masterclass is full');
    }
    return tx.payment.create({ data: { userId, masterclassId, amountCents: mc.priceCents, currency: 'usd', billingMetadata: { successUrl, cancelUrl, title: mc.title } } });
  });
  // Freeze return URLs and product data on the reservation for idempotent retries.
  const details = (payment.billingMetadata || {}) as { successUrl?: string; cancelUrl?: string; title?: string };
  if (payment.gatewayReference && !payment.checkoutSessionId) throw new HttpError(409, 'Cancel the previous payment attempt before starting hosted checkout');
  const session = payment.checkoutSessionId
    ? await stripe.checkout.sessions.retrieve(payment.checkoutSessionId)
    : await stripe.checkout.sessions.create({
      mode: 'payment', client_reference_id: payment.id,
      success_url: details.successUrl || successUrl, cancel_url: details.cancelUrl || cancelUrl,
      line_items: [{ price_data: { currency: payment.currency, unit_amount: payment.amountCents, product_data: { name: details.title || 'Masterclass' } }, quantity: 1 }],
      metadata: { paymentId: payment.id, userId, masterclassId },
      payment_intent_data: { metadata: { paymentId: payment.id, userId, masterclassId } },
    }, { idempotencyKey: 'hosted-checkout:' + payment.id });
  if (session.status === 'expired') {
    await prisma.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed' } });
    throw new HttpError(409, 'Checkout expired. Start checkout again.');
  }
  if (session.status === 'complete') throw new HttpError(409, 'Payment was submitted. Check your enrollment while confirmation completes.');
  if (!session.url) throw new HttpError(502, 'Payment provider did not return a checkout URL');
  await prisma.payment.updateMany({ where: { id: payment.id, checkoutSessionId: null }, data: { checkoutSessionId: session.id } });
  return ok(res, { paymentId: payment.id, checkoutUrl: session.url, sessionId: session.id, amountCents: payment.amountCents, currency: payment.currency });

}

export async function cancelCheckout(req: AuthRequest, res: Response) {
  const stripe = getStripe();
  const payment = await prisma.payment.findFirst({ where: { id: req.params.id, userId: req.user!.id, status: 'pending' } });
  if (!payment) throw new HttpError(404, 'Pending payment not found');
  if (payment.checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(payment.checkoutSessionId);
    if (session.status === 'complete') throw new HttpError(409, 'Payment was submitted and cannot be canceled here');
    if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
    await prisma.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed' } });
    return ok(res, { success: true });
  }
  if (!payment.gatewayReference) throw new HttpError(409, 'Retry checkout to recover its provider session before canceling');
  // Legacy PaymentIntent reservations can still be canceled.

  const intent = payment.gatewayReference
    ? await stripe.paymentIntents.retrieve(payment.gatewayReference)
    : await stripe.paymentIntents.create({ amount: payment.amountCents, currency: payment.currency, automatic_payment_methods: { enabled: true }, metadata: { paymentId: payment.id, userId: payment.userId, masterclassId: payment.masterclassId } }, { idempotencyKey: 'checkout:' + payment.id });
  if (intent.status === 'succeeded') throw new HttpError(409, 'Payment already succeeded');
  if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: 'cancel:' + payment.id });
  await prisma.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed', gatewayReference: intent.id } });
  return ok(res, { success: true });
}

export async function processPaymentEvent(event: Stripe.Event) {
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!session.metadata?.paymentId) return;
    try {
      await prisma.$transaction(async tx => {
        if (await tx.paymentWebhookEvent.findUnique({ where: { id: event.id } })) return;
        const payment = await tx.payment.findUnique({ where: { id: session.metadata!.paymentId } });
        if (!payment) throw new HttpError(503, 'Payment record is not ready');
        if (payment.checkoutSessionId && payment.checkoutSessionId !== session.id) throw new HttpError(400, 'Checkout session mismatch');
        await tx.paymentWebhookEvent.create({ data: { id: event.id, type: event.type } });
        await tx.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed', checkoutSessionId: session.id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && await prisma.paymentWebhookEvent.findUnique({ where: { id: event.id } })) return;
      throw error;
    }
    return;
  }
  const supported = ['payment_intent.succeeded', 'payment_intent.canceled', 'charge.refunded'];
  if (!supported.includes(event.type)) return;
  try {
    await prisma.$transaction(async tx => {
      if (await tx.paymentWebhookEvent.findUnique({ where: { id: event.id } })) return;
      const object = event.data.object as Stripe.PaymentIntent | Stripe.Charge;
      const reference = object.object === 'charge'
        ? (typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id)
        : object.id;
      if (!reference) return;
      const payment = await tx.payment.findFirst({ where: { OR: [{ gatewayReference: reference }, ...(object.metadata?.paymentId ? [{ id: object.metadata.paymentId }] : [])] } });
      // Retry unknown payments; never acknowledge an event before its local record exists.
      if (!payment) {
        if (!object.metadata?.paymentId) return; // Ignore unrelated Stripe account events.
        throw new HttpError(503, 'Payment record is not ready');
      }
      await tx.$queryRaw(Prisma.sql`SELECT id FROM masterclasses WHERE id = ${payment.masterclassId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`);
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (current.gatewayReference && current.gatewayReference !== reference) throw new HttpError(400, 'Payment reference mismatch');
      if (object.currency !== current.currency || object.amount !== current.amountCents) throw new HttpError(400, 'Payment amount or currency mismatch');
      await tx.paymentWebhookEvent.create({ data: { id: event.id, type: event.type } });
      if (event.type === 'payment_intent.succeeded') {
        if (object.metadata?.userId !== current.userId || object.metadata?.masterclassId !== current.masterclassId || (!('amount_received' in object) || object.amount_received !== current.amountCents)) throw new HttpError(400, 'Payment metadata mismatch');
        if (current.status === 'refunded') return;
        await tx.payment.update({ where: { id: current.id }, data: { status: 'succeeded', gatewayReference: reference } });
        await tx.enrollment.upsert({ where: { userId_masterclassId: { userId: current.userId, masterclassId: current.masterclassId } }, create: { userId: current.userId, masterclassId: current.masterclassId, paymentId: current.id }, update: {} });
        if (current.status !== 'succeeded') {
          const user = await tx.user.findUniqueOrThrow({ where: { id: current.userId } });
          const mc = await tx.masterclass.findUniqueOrThrow({ where: { id: current.masterclassId } });
          await sendPaymentReceiptEmail(user.email, user.firstName, mc.title, current.amountCents, tx);
        }
      } else if (event.type === 'charge.refunded' && object.object === 'charge' && object.refunded && object.amount_refunded === current.amountCents) {
        await tx.payment.update({ where: { id: current.id }, data: { status: 'refunded', refundedAt: new Date(), gatewayReference: reference } });
        await tx.enrollment.deleteMany({ where: { paymentId: current.id } });
      } else if (event.type === 'payment_intent.canceled') {
        await tx.payment.updateMany({ where: { id: current.id, status: 'pending' }, data: { status: 'failed', gatewayReference: reference } });
      }
    });
  } catch (error) {
    // Concurrent delivery can lose the unique-event insert race after the other transaction commits.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && await prisma.paymentWebhookEvent.findUnique({ where: { id: event.id } })) return;
    throw error;
  }
}

export async function stripeWebhook(req: Request, res: Response) {
  const stripe = getStripe();
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) throw new HttpError(400, 'Invalid webhook request');
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET!); }
  catch { throw new HttpError(400, 'Webhook signature verification failed'); }
  await processPaymentEvent(event);
  return ok(res, { received: true });
}

export async function getMyPayments(req: AuthRequest, res: Response) {
  const params = getPaginationParams(req.query);
  const where = { userId: req.user!.id };
  const [payments, total] = await Promise.all([prisma.payment.findMany({ where, skip: getSkip(params), take: params.limit, include: { masterclass: { select: { id: true, title: true, coverImageUrl: true } } }, orderBy: { createdAt: 'desc' } }), prisma.payment.count({ where })]);
  return ok(res, payments, getPaginationMeta(total, params));
}
