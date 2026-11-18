import {
  Request,
  Response,
  NextFunction,
} from 'express';

import { verifyAccessToken } from '../utils/jwt';
import { unauthorized } from '../utils/response';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (
    !authHeader ||
    !authHeader.startsWith('Bearer ')
  ) {
    return unauthorized(res);
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (!token) {
    return unauthorized(res);
  }

  try {
    const payload = verifyAccessToken(token);

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    return next();
  } catch {
    return unauthorized(
      res,
      'Invalid or expired token'
    );
  }
}
