import { z } from 'zod';
const email = z.string().trim().email().max(254).toLowerCase();
const password = z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase and a number').refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');
export const registerSchema = z.object({ firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100), email, password }).strict();
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }).strict();
export const forgotPasswordSchema = z.object({ email }).strict();
export const resetPasswordSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password }).strict();
export const updateProfileSchema = z.object({ firstName: z.string().trim().min(1).max(100).optional(), lastName: z.string().trim().min(1).max(100).optional(), avatarUrl: z.string().url().max(2048).optional() }).strict().refine(data => Object.keys(data).length > 0, 'Provide a profile field');
