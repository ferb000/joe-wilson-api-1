import { handle } from '../artists/artists.http';
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { validate } from '../../middleware/validate';
import * as controller from './admin.masterclasses.controller';
import { z } from 'zod';

const masterclassSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  coverImageUrl: z.string().url().optional().or(z.literal('')),
  priceCents: z.number().int().min(0),
  status: z.enum(['draft', 'upcoming', 'active', 'completed']).optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  maxEnrollments: z.number().int().positive().optional(),
  isPublished: z.boolean().optional(),
});

const sessionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  orderIndex: z.number().int().min(1),
  status: z.enum(['upcoming', 'live', 'completed']).optional(),
  scheduledAt: z.string().optional(),
  muxAssetId: z.string().optional(),
  muxPlaybackId: z.string().optional(),
  durationSeconds: z.number().int().positive().optional(),
  liveStreamUrl: z.string().url().optional(),
});

const router = Router();

router.use(authenticate, requireAdmin);

// Masterclasses
router.get('/', controller.listMasterclasses);
router.get('/:id', handle(controller.getMasterclass));
router.post('/', validate(masterclassSchema), controller.createMasterclass);
router.patch('/:id', controller.updateMasterclass);
router.delete('/:id', controller.deleteMasterclass);
router.get('/:id/enrollments', controller.getMasterclassEnrollments);

// Sessions within masterclasses
router.post('/:id/sessions', validate(sessionSchema), controller.addSession);
router.patch('/sessions/:sessionId', controller.updateSession);
router.delete('/sessions/:sessionId', controller.deleteSession);

export default router;
