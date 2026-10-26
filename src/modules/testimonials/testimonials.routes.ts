import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validate } from '../../middleware/validate';
import * as controller from './testimonials.controller';
import { createSchema, updateSchema } from './testimonials.schema';

const router = Router();

router.get('/', asyncHandler(controller.listTestimonials));
router.post('/', authenticate, requireAdmin, validate(createSchema), asyncHandler(controller.createTestimonial));
router.patch('/:id', authenticate, requireAdmin, validate(updateSchema), asyncHandler(controller.updateTestimonial));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(controller.deleteTestimonial));

export default router;
