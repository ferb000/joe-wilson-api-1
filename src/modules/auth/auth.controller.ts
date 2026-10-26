import { Request, Response } from 'express';
import * as authService from './auth.service';
import { AuthRequest } from '../../middleware/authenticate';
import { updateProfileSchema } from './auth.schema';
import { ok, created, badRequest, unauthorized, serverError } from '../../utils/response';
// REMOVED: import { emailQueue } from '../../jobs/email.queue' — it was imported but never used

export async function register(req: Request, res: Response) {
  try {
    const result = await authService.register(req.body);
    return created(res, result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'EMAIL_TAKEN') {
      return badRequest(res, 'An account with this email already exists');
    }
    throw err;
  }
}

export async function login(req: Request, res: Response) {
  try {
    const result = await authService.login(req.body.email, req.body.password);
    return ok(res, result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'INVALID_CREDENTIALS') {
      return unauthorized(res, 'Invalid email or password');
    }
    throw err;
  }
}

export async function refresh(req: Request, res: Response) {
  try {
    const result = await authService.refresh(req.body.refreshToken);
    return ok(res, result);
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_TOKEN') return unauthorized(res, 'Invalid or expired refresh token');
    throw err;
  }
}

export async function logout(req: AuthRequest, res: Response) {
  try {
    await authService.logout(req.user!.id);
    return ok(res, { message: 'Logged out successfully' });
  } catch (err) { throw err; }
}

export async function forgotPassword(req: Request, res: Response) {
  // Always respond with success to prevent email enumeration
  await authService.forgotPassword(req.body.email);
  return ok(res, { message: 'If this email is registered, a reset link has been sent' });
}

export async function resetPassword(req: Request, res: Response) {
  try {
    await authService.resetPassword(req.body.token, req.body.password);
    return ok(res, { message: 'Password reset successfully' });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_TOKEN') return badRequest(res, 'Invalid or expired reset token');
    throw err;
  }
}

export async function getMe(req: AuthRequest, res: Response) {
  try {
    const user = await authService.getMe(req.user!.id);
    return ok(res, user);
  } catch (err) {
    throw err;
  }
}

export async function updateMe(req: AuthRequest, res: Response) {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Invalid profile fields');
  try {
    const user = await authService.updateProfile(req.user!.id, parsed.data);
    return ok(res, user);
  } catch (err) {
    throw err;
  }
}
