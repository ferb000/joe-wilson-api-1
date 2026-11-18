import { z } from 'zod';
import { env } from '../../config/env';
import { parseYouTubeId } from './youtube';

export const id = z.string().uuid();
const name = z.string().trim().min(1).max(160);
export const slug = z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const routeIdentifier = z.union([id, slug]);
const contentSlug = slug.refine(value => !id.safeParse(value).success, 'A slug cannot be a UUID');
const artistSlug = contentSlug.refine(value => !['filters', 'regions', 'countries', 'genres'].includes(value), 'This artist slug is reserved');
const orderIndex = z.number().int().min(0).max(1_000_000);
const description = z.string().trim().max(10000).nullable();
const httpsUrl = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && (url.protocol === 'https:' || (env.NODE_ENV === 'development' && url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)));
}, 'Use an HTTPS URL without credentials');

export const regionInput = z.object({ name, slug, orderIndex: orderIndex.default(0) }).strict();
export const countryInput = z.object({
  name, code: z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter uppercase country code'),
  regionId: id, orderIndex: orderIndex.default(0),
}).strict();
export const genreInput = regionInput;
export const artistInput = z.object({
  name, slug: artistSlug, biography: description.optional(), countryId: id, genreId: id,
  isPublished: z.boolean().default(false), orderIndex: orderIndex.default(0),
}).strict();
export const projectInput = z.object({
  title: name, slug: contentSlug.optional(), description: description.optional(),
  isPublished: z.boolean().default(false), orderIndex: orderIndex.default(0),
}).strict();
export const videoInput = z.object({
  title: name.nullable().optional(),
  source: z.enum(['youtube','upload']).optional(),
  mediaId: id.optional(),
  youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Use an 11-character YouTube video ID').optional(),
  youtubeUrl: z.string().trim().max(2048).refine(value => !!parseYouTubeId(value), 'Use a valid YouTube video URL').optional(),
  customCoverUrl: httpsUrl.nullable().optional(),
  isPublished: z.boolean().default(false), orderIndex: orderIndex.default(0),
}).strict();
export const thumbnailInput = z.object({ url: httpsUrl, altText: name, orderIndex: orderIndex.default(0) }).strict();
export const creditInput = z.object({ name: name.default('Joe Wilson'), role: name, orderIndex: orderIndex.default(0) }).strict();

export function patchSchema<T extends z.AnyZodObject>(schema: T) {
  return schema.partial().refine(value => Object.keys(value).length > 0, 'Supply at least one field');
}

const queryInteger = (max: number, fallback: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().max(max)).default(String(fallback));
export const pageQuery = z.object({ page: queryInteger(1_000_000, 1), limit: queryInteger(100, 20) }).strict();
const published = z.enum(['true', 'false']).transform(value => value === 'true');
export const artistQuery = pageQuery.extend({
  region: name.optional(), country: name.optional(), genre: name.optional(),
  regionId: id.optional(), countryId: id.optional(), genreId: id.optional(),
  q: z.string().trim().max(160).optional(),
}).strict();
export const adminArtistQuery = artistQuery.extend({ isPublished: published.optional() }).strict();
export const adminChildQuery = pageQuery.extend({ isPublished: published.optional() }).strict();
export type ArtistFilters = z.infer<typeof adminArtistQuery>;

export const projectQuery = pageQuery.extend({
  q: z.string().trim().max(160).optional(),
  credit: z.string().trim().min(1).max(160).optional(),
}).strict();
export const adminProjectQuery = projectQuery.extend({ isPublished: published.optional() }).strict();
export type ProjectFilters = z.infer<typeof adminProjectQuery>;
