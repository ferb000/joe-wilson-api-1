import { ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { HttpError } from '../utils/httpError';
export function errorHandler(err: Error & { status?: number; code?: string }, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  let status = 500;
  let message = 'Internal server error';
  if (err instanceof ZodError) return res.status(400).json({ success: false, error: 'Validation failed', details: err.flatten() });
  if (err instanceof HttpError) { status = err.status; message = err.message; }
  else if (err instanceof multer.MulterError) { status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400; message = 'Invalid or oversized file upload'; }
  else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') { status = 404; message = 'Record not found'; }
    if (err.code === 'P2002') { status = 409; message = 'Record already exists'; }
    if (err.code === 'P2003') { status = 409; message = 'Record is still referenced or its related record does not exist'; }
  } else if (err instanceof Prisma.PrismaClientValidationError) { status = 400; message = 'Invalid request'; }
  else if (err.status && err.status >= 400 && err.status < 600) { status = err.status; message = status === 413 ? 'Request body too large' : status === 503 ? 'Request timed out or service unavailable' : status < 500 ? 'Invalid request' : message; }
  if (status >= 500) logger.error({ name: err.name, code: err.code, method: req.method, path: req.path }, 'Request failed');
  return res.status(status).json({ success: false, error: message, ...(env.NODE_ENV !== 'production' && { stack: err.stack }) });
}
