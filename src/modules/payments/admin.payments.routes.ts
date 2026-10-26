import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import * as controller from './admin.payments.controller';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/', asyncHandler(controller.listPayments));
router.post('/:id/refund', asyncHandler(controller.refundPayment));
router.get('/export/csv', asyncHandler(controller.exportCsv));

export default router;
