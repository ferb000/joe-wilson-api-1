import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireEnrollment } from '../../middleware/requireEnrollment';
import * as controller from './sessions.controller';

const router = Router();

router.get('/:id', authenticate, requireEnrollment, asyncHandler(controller.getSession));
router.post('/:id/progress', authenticate, requireEnrollment, asyncHandler(controller.updateProgress));

export default router;
