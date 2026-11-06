import { join } from 'path';
import { Router, raw, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { HttpError } from '../../utils/httpError';
import { headLocalObject, localObjectPath, localStorageRoot, writeLocalPart } from './local.storage';

const grantSchema = z.object({ key: z.string(), operation: z.enum(['read', 'part']), uploadId: z.string().optional(), partNumber: z.number().int().positive().optional() });
export function localFileUrl(key: string, expiresIn: number, part?: { uploadId: string; partNumber: number }) {
  localObjectPath(key);
  const token = jwt.sign({ key, operation: part ? 'part' : 'read', ...part }, env.JWT_SECRET, { algorithm: 'HS256', audience: 'local-file', expiresIn });
  return env.API_PUBLIC_URL.replace(/\/$/, '') + '/v1/local-files/' + (part ? 'part' : 'private') + '?token=' + encodeURIComponent(token);
}
function verify(token: unknown, operation: 'read' | 'part') {
  try {
    if (typeof token !== 'string' || token.length > 4096) throw new Error();
    const grant = grantSchema.parse(jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: 'local-file' }));
    if (grant.operation !== operation) throw new Error();
    return grant;
  } catch { throw new HttpError(401, 'Invalid or expired file link'); }
}
const router = Router();
router.use((_req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); next(); });
router.get('/public/*', asyncHandler(async (req, res) => {
  const key = 'public/' + req.params[0]; const head = await headLocalObject(key);
  res.setHeader('Cache-Control', 'public, max-age=300'); res.type(head.ContentType);
  res.sendFile(key, { root: join(localStorageRoot, 'objects'), dotfiles: 'deny' });
}));
router.get('/private', asyncHandler(async (req, res) => {
  const grant = verify(req.query.token, 'read'); const head = await headLocalObject(grant.key);
  res.setHeader('Cache-Control', 'private, no-store'); res.type(head.ContentType);
  res.sendFile(grant.key, { root: join(localStorageRoot, 'objects'), dotfiles: 'deny' });
}));
router.put('/part', raw({ type: () => true, limit: 10 * 1024 * 1024 }) as RequestHandler, asyncHandler(async (req, res) => {
  const grant = verify(req.query.token, 'part');
  if (!grant.uploadId || !grant.partNumber || !Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Invalid upload part');
  const etag = await writeLocalPart(grant.uploadId, grant.key, grant.partNumber, req.body);
  res.setHeader('ETag', etag); res.status(200).end();
}));
export default router;
