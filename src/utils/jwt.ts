import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
export interface JwtPayload { sub: string; email: string; role: string; version: number }
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}
export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { algorithm: 'HS256', jwtid: randomUUID(), expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}
export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.role !== 'string' || !Number.isInteger(payload.version)) throw new Error('INVALID_TOKEN');
  return payload as unknown as JwtPayload;
}
export function verifyRefreshToken(token: string): { sub: string } {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') throw new Error('INVALID_TOKEN');
  return { sub: payload.sub };
}
