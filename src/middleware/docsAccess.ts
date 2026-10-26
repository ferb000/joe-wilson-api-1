import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { env } from '../config/env';
export function docsAccess(req: Request, res: Response, next: NextFunction) {
  if (!env.DOCS_TOKEN) return env.NODE_ENV === 'production' ? res.sendStatus(404) : next();
  const header = req.headers.authorization || '';
  let supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (header.startsWith('Basic ')) {
    const credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (credentials.slice(0, separator) === 'docs') supplied = credentials.slice(separator + 1);
  }
  const actual = Buffer.from(supplied), expected = Buffer.from(env.DOCS_TOKEN);
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="API documentation"');
  return res.sendStatus(401);
}
