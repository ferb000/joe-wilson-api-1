import { z } from 'zod';
export const createSchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), title: z.string().trim().min(1).max(255), tagline: z.string().max(500).optional(), description: z.string().max(20000).optional(), coverImageUrl: z.string().url().max(2048).nullable().optional(), isPublished: z.boolean().optional(), orderIndex: z.number().int().nonnegative() }).strict();
export const updateSchema = createSchema.partial().refine(data => Object.keys(data).length > 0, 'Provide a field to update');
