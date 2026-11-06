import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';
export const redisEnabled = env.NODE_ENV !== 'development' || env.REDIS_ENABLED;
export function redisOptions(worker = false) {
  return { ...(env.REDIS_URL.startsWith('rediss://') && { tls: {} }), maxRetriesPerRequest: worker ? null : 3, enableReadyCheck: true, lazyConnect: !redisEnabled };
}
export function createRedisConnection(worker = false) {
  const client = new Redis(env.REDIS_URL, redisOptions(worker));
  client.on('error', () => logger.error('Redis connection failed'));
  return client;
}
export const redis = createRedisConnection();
