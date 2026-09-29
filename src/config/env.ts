if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

import { z } from 'zod';

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    JWT_SECRET: z
      .string()
      .min(64, 'JWT_SECRET must be at least 64 characters'),

    JWT_REFRESH_SECRET: z
      .string()
      .min(64, 'JWT_REFRESH_SECRET must be at least 64 characters'),

    JWT_EXPIRES_IN: z.string().default('15m'),

    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

    PORT: z.string().optional(),

    NODE_ENV: z
      .string()
      .trim()
      .refine(
        (val) => ['development', 'production'].includes(val),
        {
          message:
            "NODE_ENV must be 'development' or 'production'",
        }
      ),

    FRONTEND_URLS: z
      .string()
      .default('http://localhost:3000'),

    DOCS_TOKEN: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().optional(),

    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    AWS_ACCESS_KEY_ID: z.string().optional(),

    AWS_SECRET_ACCESS_KEY: z.string().optional(),

    S3_BUCKET: z.string().optional(),

    S3_REGION: z.string().optional(),

    S3_ENDPOINT: z.string().optional(),

    MUX_TOKEN_ID: z.string().optional(),

    MUX_TOKEN_SECRET: z.string().optional(),

    MUX_SIGNING_KEY_ID: z.string().optional(),

    MUX_SIGNING_PRIVATE_KEY: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),

    RESEND_FROM_EMAIL: z
      .string()
      .default('noreply@mrwilson.com'),

    ADMIN_EMAIL: z
      .string()
      .default('joseph@mrwilson.com'),

    REDIS_URL: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.JWT_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'JWT_SECRET and JWT_REFRESH_SECRET must be different values',
      });
    }

    if (
      data.NODE_ENV === 'production' &&
      !data.REDIS_URL
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message:
          'REDIS_URL is required in production',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten());
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
