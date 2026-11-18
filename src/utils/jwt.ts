import jwt, { JwtPayload as JsonWebTokenPayload } from 'jsonwebtoken';
import { env } from '../config/env';

const JWT_ISSUER = 'mr-wilson-api';
const ACCESS_AUDIENCE = 'mr-wilson-api';
const REFRESH_AUDIENCE = 'mr-wilson-api-refresh';

export interface AccessTokenPayload extends JsonWebTokenPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access';
}

export interface RefreshTokenPayload extends JsonWebTokenPayload {
  sub: string;
  type: 'refresh';
}

export function signAccessToken(payload: {
  sub: string;
  email: string;
  role: string;
}): string {
  return jwt.sign(
    {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      type: 'access',
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
      issuer: JWT_ISSUER,
      audience: ACCESS_AUDIENCE,
      algorithm: 'HS256',
    }
  );
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(
    {
      sub: payload.sub,
      type: 'refresh',
    },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
      issuer: JWT_ISSUER,
      audience: REFRESH_AUDIENCE,
      algorithm: 'HS256',
    }
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: ACCESS_AUDIENCE,
  });

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.email !== 'string' ||
    typeof decoded.role !== 'string' ||
    decoded.type !== 'access'
  ) {
    throw new Error('INVALID_ACCESS_TOKEN');
  }

  return decoded as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: REFRESH_AUDIENCE,
  });

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof decoded.sub !== 'string' ||
    decoded.type !== 'refresh'
  ) {
    throw new Error('INVALID_REFRESH_TOKEN');
  }

  return decoded as RefreshTokenPayload;
}
