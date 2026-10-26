import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import * as controller from './users.controller';

const router = Router();

router.get('/', authenticate, requireAdmin, asyncHandler(controller.listUsers));
router.get('/:id', authenticate, requireAdmin, asyncHandler(controller.getUser));

export default router;
