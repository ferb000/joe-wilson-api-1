import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
export const validate = (schema: ZodSchema, target: 'body' | 'query' | 'params' = 'body') => (req: Request, res: Response, next: NextFunction) => {
  const parsed = schema.safeParse(req[target]);
  if (!parsed.success) return res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten() });
  req[target] = parsed.data;
  next();
};
