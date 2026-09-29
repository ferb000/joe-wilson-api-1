import { Request, Response, NextFunction } from 'express';

import { env } from '../config/env';

export function docsAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (env.NODE_ENV !== 'production') {
    return next();
  }

  if (!env.DOCS_TOKEN) {
    return res.status(404).json({
      success: false,
      message: 'Not found',
    });
  }

  const suppliedToken = req.header('X-Docs-Token');

  if (!suppliedToken || suppliedToken !== env.DOCS_TOKEN) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  return next();
}
