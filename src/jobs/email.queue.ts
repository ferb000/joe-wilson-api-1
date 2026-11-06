import { Queue } from 'bullmq';
import { redis, redisEnabled } from '../config/redis';

// Uses the shared Redis instance from config/redis.ts (reads REDIS_URL from env).
// Previously this was hardcoded to localhost:6379 which silently fails in production.
export const emailQueue = redisEnabled ? new Queue('emailQueue', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
}) : null;
