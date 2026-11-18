import { Request, Response, NextFunction } from 'express';

import { logger } from '../config/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error(
    {
      err,
      method: req.method,
      path: req.path,
      ip: req.ip,
      requestId: req.id,
    },
    'Unhandled error'
  );

  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    requestId: req.id,
  });
}
