import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import * as controller from './dashboard.controller';

const router = Router();

router.get('/', authenticate, requireAdmin, asyncHandler(controller.getDashboard));

export default router;
