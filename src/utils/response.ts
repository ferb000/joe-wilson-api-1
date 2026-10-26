import { Response } from 'express';
import { PaginationMeta } from './pagination';

export function ok<T>(res: Response, data: T, meta?: PaginationMeta) {
  if (res.headersSent) return res;
  return res.status(200).json({ success: true, data, ...(meta && { meta }) });
}

export function created<T>(res: Response, data: T) {
  if (res.headersSent) return res;
  return res.status(201).json({ success: true, data });
}

export function noContent(res: Response) {
  if (res.headersSent) return res;
  return res.status(204).send();
}

export function badRequest(res: Response, error: string) {
  if (res.headersSent) return res;
  return res.status(400).json({ success: false, error });
}

export function unauthorized(res: Response, error = 'Unauthorized') {
  if (res.headersSent) return res;
  return res.status(401).json({ success: false, error });
}

export function forbidden(res: Response, error = 'Forbidden') {
  if (res.headersSent) return res;
  return res.status(403).json({ success: false, error });
}

export function notFound(res: Response, error = 'Not found') {
  if (res.headersSent) return res;
  return res.status(404).json({ success: false, error });
}

export function serverError(res: Response, error = 'Something went wrong') {
  if (res.headersSent) return res;
  return res.status(500).json({ success: false, error });
}
