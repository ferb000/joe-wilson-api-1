import { validate } from '../../middleware/validate';
import { createSchema, updateSchema } from './events.schema';
import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import * as controller from './events.controller';

const router = Router();

router.get('/', asyncHandler(controller.listEvents));
router.post('/', authenticate, requireAdmin, validate(createSchema), asyncHandler(controller.createEvent));
router.patch('/:id', authenticate, requireAdmin, validate(updateSchema), asyncHandler(controller.updateEvent));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(controller.deleteEvent));

export default router;
