import { Request, Response, NextFunction, RequestHandler } from 'express';
export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => { Promise.resolve().then(() => { if (!res.headersSent && !(req as Request & { timedout?: boolean }).timedout) return handler(req, res, next); }).catch(next); };
}
