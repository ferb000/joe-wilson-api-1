import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { contactLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import * as controller from './quotes.controller';
import { z } from 'zod';

const submitSchema = z.object({
  serviceId: z.string().uuid(),
  clientName: z.string().trim().min(1).max(10000),
  clientEmail: z.string().trim().email().max(254).toLowerCase(),
  clientPhone: z.string().max(10000).optional(),
  eventDate: z.string().date().or(z.string().datetime({ offset: true })).optional(),
  eventType: z.string().max(10000).optional(),
  location: z.string().max(10000).optional(),
  durationNotes: z.string().max(10000).optional(),
  budgetMinCents: z.number().int().positive().optional(),
  budgetMaxCents: z.number().int().positive().optional(),
  projectNotes: z.string().max(10000).optional(),
}).strict().refine(data => data.budgetMinCents === undefined || data.budgetMaxCents === undefined || data.budgetMinCents <= data.budgetMaxCents, 'Minimum budget must not exceed maximum budget');

const statusSchema = z.object({
  status: z.enum(['new', 'reviewing', 'quoted', 'booked', 'closed']),
  adminNotes: z.string().max(10000).optional(),
});

const router = Router();

router.post('/', contactLimiter, validate(submitSchema), asyncHandler(controller.submitQuote));
router.get('/', authenticate, requireAdmin, asyncHandler(controller.listQuotes));
router.get('/:id', authenticate, requireAdmin, asyncHandler(controller.getQuote));
router.patch('/:id/status', authenticate, requireAdmin, validate(statusSchema), asyncHandler(controller.updateQuoteStatus));

export default router;
