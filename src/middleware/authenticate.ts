import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../config/database';
import { unauthorized } from '../utils/response';
export interface AuthRequest extends Request { user?: { id: string; email: string; role: string } }
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !/^Bearer \S+$/.test(header)) return unauthorized(res);
  let payload;
  try { payload = verifyAccessToken(header.slice(7)); }
  catch { return unauthorized(res, 'Invalid or expired token'); }
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, role: true, tokenVersion: true } });
    if (!user || user.tokenVersion !== payload.version) return unauthorized(res, 'Invalid or expired token');
    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (error) { next(error); }
}
export function optionalAuthenticate(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
}
