import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { contactLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import * as controller from './inquiries.controller';
import { z } from 'zod';

const submitSchema = z.object({
  senderName: z.string().trim().min(1).max(10000).max(255),
  senderEmail: z.string().trim().email().max(254).toLowerCase(),
  senderPhone: z.string().max(10000).optional(),
  type: z.enum(['general', 'booking']),
  subject: z.string().max(10000).optional(),
  message: z.string().min(1),
});

const replySchema = z.object({ replyText: z.string().min(1) });

const router = Router();

// Public
router.post('/', contactLimiter, validate(submitSchema), asyncHandler(controller.submitInquiry));

// Admin
router.get('/', authenticate, requireAdmin, asyncHandler(controller.listInquiries));
router.get('/:id', authenticate, requireAdmin, asyncHandler(controller.getInquiry));
router.post('/:id/reply', authenticate, requireAdmin, validate(replySchema), asyncHandler(controller.replyToInquiry));
router.patch('/:id/handle', authenticate, requireAdmin, asyncHandler(controller.handleInquiry));

export default router;
