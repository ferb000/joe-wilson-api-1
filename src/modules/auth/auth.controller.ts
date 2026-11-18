import { Request, Response } from 'express';
import * as authService from './auth.service';
import { AuthRequest } from '../../middleware/authenticate';

import {
  ok,
  created,
  badRequest,
  unauthorized,
  serverError,
} from '../../utils/response';

export async function register(
  req: Request,
  res: Response
) {
  try {
    const result = await authService.register(req.body);

    return created(res, result);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message === 'EMAIL_TAKEN'
    ) {
      return badRequest(
        res,
        'An account with this email already exists'
      );
    }

    return serverError(res);
  }
}

export async function login(
  req: Request,
  res: Response
) {
  try {
    const result = await authService.login(
      req.body.email,
      req.body.password
    );

    return ok(res, result);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message === 'INVALID_CREDENTIALS'
    ) {
      return unauthorized(
        res,
        'Invalid email or password'
      );
    }

    return serverError(res);
  }
}

export async function refresh(
  req: Request,
  res: Response
) {
  try {
    const result = await authService.refresh(
      req.body.refreshToken
    );

    return ok(res, result);
  } catch {
    return unauthorized(
      res,
      'Invalid or expired refresh token'
    );
  }
}

export async function logout(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user?.id) {
      return unauthorized(res);
    }

    await authService.logout(req.user.id);

    return ok(res, {
      message: 'Logged out successfully',
    });
  } catch {
    return serverError(res);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response
) {
  try {
    await authService.forgotPassword(
      req.body.email
    );
  } catch (error) {
    /*
     * Do not expose account existence or internal
     * password-reset errors.
     */
    console.error(
      '[AUTH] Password reset request failed:',
      error
    );
  }

  return ok(res, {
    message:
      'If this email is registered, a reset link has been sent',
  });
}

export async function resetPassword(
  req: Request,
  res: Response
) {
  try {
    await authService.resetPassword(
      req.body.token,
      req.body.password
    );

    return ok(res, {
      message: 'Password reset successfully',
    });
  } catch {
    return badRequest(
      res,
      'Invalid or expired reset token'
    );
  }
}

export async function getMe(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user?.id) {
      return unauthorized(res);
    }

    const user = await authService.getMe(
      req.user.id
    );

    return ok(res, user);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message === 'USER_NOT_FOUND'
    ) {
      return unauthorized(res);
    }

    return serverError(res);
  }
}

export async function updateMe(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user?.id) {
      return unauthorized(res);
    }

    const user = await authService.updateProfile(
      req.user.id,
      req.body
    );

    return ok(res, user);
  } catch {
    return serverError(res);
  }
}
