import { z } from 'zod';
export const createSchema = z.object({ quote: z.string().min(1).max(10000), authorName: z.string().min(1).max(255), authorOrg: z.string().max(255).optional(), avatarUrl: z.string().url().max(2048).nullable().optional(), isFeatured: z.boolean().optional(), orderIndex: z.number().int().nonnegative() }).strict();
export const updateSchema = createSchema.partial().refine(data => Object.keys(data).length > 0, 'Provide a field to update');
