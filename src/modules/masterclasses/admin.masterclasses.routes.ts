import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validate } from '../../middleware/validate';
import * as controller from './admin.masterclasses.controller';
import { createMasterclassSchema as masterclassSchema, createSessionSchema as sessionSchema } from './admin.masterclasses.controller';

const router = Router();

router.use(authenticate, requireAdmin);

// Masterclasses
router.get('/', asyncHandler(controller.listMasterclasses));
router.get('/:id', asyncHandler(controller.getMasterclass));
router.post('/', validate(masterclassSchema), asyncHandler(controller.createMasterclass));
router.patch('/:id', asyncHandler(controller.updateMasterclass));
router.delete('/:id', asyncHandler(controller.deleteMasterclass));
router.get('/:id/enrollments', asyncHandler(controller.getMasterclassEnrollments));

// Sessions within masterclasses
router.post('/:id/sessions', validate(sessionSchema), asyncHandler(controller.addSession));
router.patch('/sessions/:sessionId', asyncHandler(controller.updateSession));
router.delete('/sessions/:sessionId', asyncHandler(controller.deleteSession));

export default router;
