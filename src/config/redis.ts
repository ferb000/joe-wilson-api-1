import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';
export function redisOptions(worker = false) {
  return { ...(env.REDIS_URL.startsWith('rediss://') && { tls: {} }), maxRetriesPerRequest: worker ? null : 3, enableReadyCheck: true };
}
export function createRedisConnection(worker = false) {
  const client = new Redis(env.REDIS_URL, redisOptions(worker));
  client.on('error', () => logger.error('Redis connection failed'));
  return client;
}
export const redis = createRedisConnection();
