import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import * as controller from './settings.controller';

const router = Router();

router.get('/public', asyncHandler(controller.getPublicSettings));
router.get('/', authenticate, requireAdmin, asyncHandler(controller.getAllSettings));
router.patch('/', authenticate, requireAdmin, asyncHandler(controller.updateSettings));

export default router;
