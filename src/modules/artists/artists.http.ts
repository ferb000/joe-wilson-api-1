import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../../config/logger';
import { notFound } from '../../utils/response';
import { id } from './artists.schema';

export function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>, context = 'artist portfolio'): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => fn(req, res, next)).catch(error => {
      if (error instanceof ZodError) return res.status(400).json({ success: false, error: `Validation failed: ${error.issues[0]?.message ?? 'Check your input'}`, details: error.issues });
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return notFound(res);
        if (error.code === 'P2002') return res.status(409).json({ success: false, error: 'A record with these unique fields already exists' });
        if (['P2003', 'P2014'].includes(error.code)) return res.status(409).json({ success: false, error: 'Related record is missing or still in use' });
      }
      logger.error({ err: error, path: req.path }, `${context} request failed`);
      if (error instanceof Prisma.PrismaClientInitializationError || (error instanceof Prisma.PrismaClientKnownRequestError && ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code))) {
        res.setHeader('Retry-After', '5');
        return res.status(503).json({ success: false, error: `${context} is temporarily unavailable. Please try again.` });
      }
      return res.status(500).json({ success: false, error: `Could not complete this ${context} request. Please try again.` });
    });
  };
}

// Validation happens after authentication for admin routes. Parsed values (including
// defaults) are used directly; raw request bodies never reach Prisma.
export function validateParams(params: Record<string, string>) {
  for (const value of Object.values(params)) id.parse(value);
}
export const invalidParent = (res: Response) => notFound(res, 'Artist, project or video not found');
