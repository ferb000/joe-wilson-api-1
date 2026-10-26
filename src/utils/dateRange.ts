import { z } from 'zod';
import { HttpError } from './httpError';
export const dateString = z.string().date().or(z.string().datetime({ offset: true }));
export function dateRange(query: { from?: unknown; to?: unknown }) {
  const from = query.from === undefined ? undefined : new Date(dateString.parse(query.from));
  const to = query.to === undefined ? undefined : new Date(dateString.parse(query.to));
  if (from && to && from > to) throw new HttpError(400, 'from must be before to');
  return from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : undefined;
}
