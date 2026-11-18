import { Router } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { handle } from '../artists/artists.http';
import { prisma } from '../../config/database';
import { forbidden } from '../../utils/response';
import * as controller from './media.controller';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
const router = Router();
router.use(authenticate, requireAdmin, handle(async (req: AuthRequest, res, next) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { role: true } });
  return user?.role === 'owner' ? next() : forbidden(res, 'Admin access required');
}));
router.get('/', handle(controller.listMedia, 'media library'));
router.post('/upload', (req, res, next) => upload.single('file')(req, res, error => {
  if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 50 MB or smaller' : 'Choose one file using the file picker' });
  next();
}), handle(controller.uploadMedia, 'media library'));
router.delete('/:id', handle(controller.deleteMedia, 'media library'));
export default router;
