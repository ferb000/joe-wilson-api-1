import { asyncHandler } from '../../utils/asyncHandler';
import { Router, Request, Response } from 'express';
import express from 'express';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import * as controller from './payments.controller';

const router = Router();

// IMPORTANT: Webhook route must use raw body parser before express.json()
router.post(
    '/webhook',
    express.raw({ type: 'application/json' }) as express.RequestHandler,
    asyncHandler(controller.stripeWebhook)
  );

router.post('/checkout', authenticate, validate(controller.checkoutSchema), asyncHandler(controller.createCheckout));
router.delete('/checkout/:id', authenticate, asyncHandler(controller.cancelCheckout));
router.get('/my', authenticate, asyncHandler(controller.getMyPayments));

export default router;
