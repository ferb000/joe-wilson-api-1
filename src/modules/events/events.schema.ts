import { z } from 'zod';
export const createSchema = z.object({ description: z.string().max(20000).optional(), location: z.string().max(500).optional(), title: z.string().trim().min(1).max(255), venue: z.string().max(255).optional(), city: z.string().max(255).optional(), country: z.string().max(255).optional(), eventDate: z.string().datetime({ offset: true }), ticketUrl: z.string().url().max(2048).optional(), isPublished: z.boolean().optional() }).strict();
export const updateSchema = createSchema.partial().refine(data => Object.keys(data).length > 0, 'Provide a field to update');
