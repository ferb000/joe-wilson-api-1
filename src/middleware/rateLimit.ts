import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { redis } from '../config/redis';

function createRedisStore(prefix: string) {
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redis.call(args[0], ...args.slice(1)) as Promise<any>,
  });
}

const fifteenMinutes = 15 * 60 * 1000;

export const globalLimiter = rateLimit({
  store: createRedisStore('rl:global:'),
  windowMs: fifteenMinutes,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

export const loginLimiter = rateLimit({
  store: createRedisStore('rl:login:'),
  windowMs: fifteenMinutes,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
  },
});

export const registerLimiter = rateLimit({
  store: createRedisStore('rl:register:'),
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many registration attempts. Please try again later.',
  },
});

export const refreshLimiter = rateLimit({
  store: createRedisStore('rl:refresh:'),
  windowMs: fifteenMinutes,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many refresh attempts. Please try again later.',
  },
});

export const forgotPasswordLimiter = rateLimit({
  store: createRedisStore('rl:forgot-password:'),
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password reset requests. Please try again later.',
  },
});

export const resetPasswordLimiter = rateLimit({
  store: createRedisStore('rl:reset-password:'),
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password reset attempts. Please try again later.',
  },
});