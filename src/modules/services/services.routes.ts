import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validate } from '../../middleware/validate';
import * as controller from './services.controller';
import { createSchema, updateSchema } from './services.schema';

const router = Router();

router.get('/', asyncHandler(controller.listServices));
router.get('/:slug', asyncHandler(controller.getService));
router.post('/', authenticate, requireAdmin, validate(createSchema), asyncHandler(controller.createService));
router.patch('/:id', authenticate, requireAdmin, validate(updateSchema), asyncHandler(controller.updateService));
router.delete('/:id', authenticate, requireAdmin, asyncHandler(controller.deleteService));

export default router;
