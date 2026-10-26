import Stripe from 'stripe';
import { env } from './env';
import { HttpError } from '../utils/httpError';
let client: Stripe | undefined;
export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Payment gateway is not configured');
  return client ||= new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 8000 });
}
