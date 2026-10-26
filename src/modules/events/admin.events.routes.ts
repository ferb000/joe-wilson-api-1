import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { asyncHandler } from '../../utils/asyncHandler';
import { listAll } from './events.controller';
const router = Router();
router.use(authenticate, requireAdmin);
router.get('/', asyncHandler(listAll));
export default router;
