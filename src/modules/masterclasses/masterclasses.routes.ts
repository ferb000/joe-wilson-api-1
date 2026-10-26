import { asyncHandler } from '../../utils/asyncHandler';
import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middleware/authenticate';
import { requireEnrollment } from '../../middleware/requireEnrollment';
import * as controller from './masterclasses.controller';

const router = Router();

// Public catalog: visitors can browse published masterclasses before signing up.
router.get('/', optionalAuthenticate, asyncHandler(controller.listMasterclasses));
router.get('/:id', authenticate, asyncHandler(controller.getMasterclass));
router.get('/:id/sessions', authenticate, asyncHandler(controller.getMasterclassSessions));

export default router;
