import 'dotenv/config';
import { z } from 'zod';
const optional = z.string().optional();
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32), JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().regex(/^\d+(ms|s|m|h|d)$/).default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+(ms|s|m|h|d)$/).default('30d'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URLS: z.string().default('http://localhost:3000').refine(value => value.split(',').every(origin => { try { const url = new URL(origin.trim()); return ['http:','https:'].includes(url.protocol) && url.origin === origin.trim(); } catch { return false; } }), 'Use comma-separated HTTP origins without trailing slashes'),
  DOCS_TOKEN: optional,
  API_PUBLIC_URL: z.string().url().default('http://localhost:3001').refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.search && !url.hash && !url.username && !url.password; }, 'Use a public HTTP API base URL without credentials or queries'),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  VIDEO_MAX_DURATION_SECONDS: z.coerce.number().int().positive().max(43200).default(14400),
  VIDEO_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().max(50 * 1024 ** 3).default(10 * 1024 ** 3),
  VIDEO_TRANSCODE_TIMEOUT_SECONDS: z.coerce.number().int().positive().max(86400).default(21600),
  VIDEO_TRANSCODE_THREADS: z.coerce.number().int().min(1).max(16).default(2),
  VIDEO_TRANSCODE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  VIDEO_PLAYBACK_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(3600),
  STRIPE_SECRET_KEY: optional, STRIPE_WEBHOOK_SECRET: optional,
  AWS_ACCESS_KEY_ID: optional, AWS_SECRET_ACCESS_KEY: optional,
  S3_BUCKET: optional, S3_REGION: z.string().default('us-east-1'), S3_ENDPOINT: z.string().url().optional().or(z.literal('')),
  S3_PUBLIC_BASE_URL: z.string().url().optional().or(z.literal('')),
  S3_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(5 * 1024 ** 3).default(5 * 1024 ** 3),
  RESEND_API_KEY: optional, RESEND_FROM_EMAIL: z.string().email().default('noreply@mrwilson.com'), ADMIN_EMAIL: z.string().email().default('joseph@mrwilson.com'),
  REDIS_URL: z.string().url().refine(value => /^rediss?:\/\//.test(value), 'REDIS_URL must use redis:// or rediss://'),
}).refine(data => data.JWT_SECRET !== data.JWT_REFRESH_SECRET, { message: 'JWT secrets must be different', path: ['JWT_REFRESH_SECRET'] }).refine(data => !!data.AWS_ACCESS_KEY_ID === !!data.AWS_SECRET_ACCESS_KEY, { message: 'Supply both AWS credentials or use an IAM role', path: ['AWS_SECRET_ACCESS_KEY'] });
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) throw new Error('Invalid environment configuration: ' + parsed.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; '));
export const env = parsed.data;
