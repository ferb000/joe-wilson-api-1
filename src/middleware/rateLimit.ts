import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis';
function limiter(prefix: string, limit: number) {
  return rateLimit({ store: new RedisStore({ prefix, sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as Promise<any> }), windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, error: 'Too many requests. Please try again later.' } });
}
export const globalLimiter = limiter('rate:global:', 300);
export const authLimiter = limiter('rate:auth:', 10);
export const contactLimiter = limiter('rate:contact:', 10);

// HLS requests use a separate, higher quota than JSON API requests.
export const playbackLimiter = limiter('rate:playback:', 6000);
