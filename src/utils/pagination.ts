import { HttpError } from './httpError';
export interface PaginationParams { page: number; limit: number }
export interface PaginationMeta { page: number; limit: number; total: number; totalPages: number }
export function getPaginationParams(query: { page?: unknown; limit?: unknown }): PaginationParams {
  const parse = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw new HttpError(400, 'Pagination must use positive integers');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > max) throw new HttpError(400, 'Pagination value exceeds the allowed maximum');
    return number;
  };
  return { page: parse(query.page, 1, 1000000), limit: parse(query.limit, 20, 100) };
}
export function getPaginationMeta(total: number, params: PaginationParams): PaginationMeta { return { ...params, total, totalPages: Math.ceil(total / params.limit) }; }
export function getSkip(params: PaginationParams): number { return (params.page - 1) * params.limit; }
