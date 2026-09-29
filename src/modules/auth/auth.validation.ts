import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    firstName: z
      .string()
      .min(1, 'First name is required')
      .max(50, 'First name too long'),

    lastName: z
      .string()
      .min(1, 'Last name is required')
      .max(50, 'Last name too long'),

    email: z
      .string()
      .email('Invalid email address')
      .toLowerCase(),

    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(100, 'Password too long')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain uppercase, lowercase and a number'
      ),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string()
      .email('Invalid email address')
      .toLowerCase(),

    password: z
      .string()
      .min(1, 'Password is required'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z
      .string()
      .email('Invalid email address')
      .toLowerCase(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z
      .string()
      .min(10, 'Invalid token'),

    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(100)
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain uppercase, lowercase and a number'
      ),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z
      .string()
      .min(20, 'Invalid refresh token'),
  }),
});
