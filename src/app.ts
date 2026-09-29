console.log('🚀 APP STARTING...');
import 'dotenv/config';
import './config/env';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import timeout from 'connect-timeout';
import { randomUUID } from 'crypto';

import { env } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { logger } from './config/logger';
import { swaggerSpec } from './config/swagger';
import { emailQueue } from './jobs/email.queue';

import { errorHandler } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimit';
import { httpLogger } from './middleware/logger';

// Routes
import authRoutes from './modules/auth/auth.routes';
import masterclassRoutes from './modules/masterclasses/masterclasses.routes';
import adminMasterclassRoutes from './modules/masterclasses/admin.masterclasses.routes';
import sessionRoutes from './modules/sessions/sessions.routes';
import enrollmentRoutes from './modules/enrollments/enrollments.routes';
import paymentRoutes from './modules/payments/payments.routes';
import adminPaymentRoutes from './modules/payments/admin.payments.routes';
import inquiryRoutes from './modules/inquiries/inquiries.routes';
import quoteRoutes from './modules/quotes/quotes.routes';
import serviceRoutes from './modules/services/services.routes';
import eventRoutes from './modules/events/events.routes';
import testimonialRoutes from './modules/testimonials/testimonials.routes';
import settingsRoutes from './modules/settings/settings.routes';
import mediaRoutes from './modules/media/media.routes';
import userRoutes from './modules/users/users.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';

const app = express();

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
  });
});
app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'JW API is running 🚀',
  });
});
// ─────────────────────────────────────────────
// TRUST PROXY
// ─────────────────────────────────────────────
app.set('trust proxy', 1);

// ─────────────────────────────────────────────
// REQUEST ID
// ─────────────────────────────────────────────
app.use((req: any, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ─────────────────────────────────────────────
// TIMEOUT (skip docs + health)
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  if (
    req.path.startsWith('/docs') ||
    req.path.startsWith('/swagger-json') ||
    req.path === '/health'
  ) {
    return next();
  }

  return timeout('10s')(req, res, next);
});

// Prevent execution after timeout
function haltOnTimedout(req: any, _res: any, next: any) {
  if (!req.timedout) next();
}
app.use(haltOnTimedout);

// ─────────────────────────────────────────────
// SECURITY
// ─────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }) as express.RequestHandler
);

// ─────────────────────────────────────────────
// CORS (restricted)
// ─────────────────────────────────────────────
const allowedOrigins = env.FRONTEND_URLS
  .split(',')
  .map((o: string) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ─────────────────────────────────────────────
// RATE LIMIT
// ─────────────────────────────────────────────
app.use(globalLimiter);

// ─────────────────────────────────────────────
// PERFORMANCE
// ─────────────────────────────────────────────
app.use(compression());

// ─────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────
app.use(httpLogger as unknown as express.RequestHandler);

// ─────────────────────────────────────────────
// SWAGGER DOCS
// ─────────────────────────────────────────────

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/swagger-json', (_req, res) => {
  res.json(swaggerSpec);
});
// ─────────────────────────────────────────────
// BODY PARSERS
// ─────────────────────────────────────────────

// Stripe webhook FIRST
app.use(
  '/v1/payments/webhook',
  express.raw({ type: 'application/json' }) as express.RequestHandler
);

app.use(express.json({ limit: '1mb' }) as express.RequestHandler);
app.use(express.urlencoded({ extended: true, limit: '1mb' }) as express.RequestHandler);

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

// Public
app.use('/v1/auth', authRoutes);
app.use('/v1/services', serviceRoutes);
app.use('/v1/events', eventRoutes);
app.use('/v1/testimonials', testimonialRoutes);
app.use('/v1/settings', settingsRoutes);
app.use('/v1/inquiries', inquiryRoutes);
app.use('/v1/quotes', quoteRoutes);

// Member
app.use('/v1/masterclasses', masterclassRoutes);
app.use('/v1/sessions', sessionRoutes);
app.use('/v1/enrollments', enrollmentRoutes);
app.use('/v1/payments', paymentRoutes);

// Admin
app.use('/v1/admin/dashboard', dashboardRoutes);
app.use('/v1/admin/masterclasses', adminMasterclassRoutes);
app.use('/v1/admin/payments', adminPaymentRoutes);
app.use('/v1/admin/users', userRoutes);
app.use('/v1/admin/media', mediaRoutes);

// ─────────────────────────────────────────────
// 404
// ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Wilson API running on port ${PORT} [${env.NODE_ENV}]`);
  logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
});

// ─────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.error('Forced exit after 10s timeout');
    process.exit(1);
  }, 10000);

  forceExit.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('Database disconnected');

      await emailQueue.close();
      logger.info('Email queue closed');

      if (redis?.status === 'ready') {
        await redis.quit();
        logger.info('Redis disconnected');
      }

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error(err, 'Error during shutdown');
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  logger.error(error, 'UNCAUGHT EXCEPTION');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(reason, 'UNHANDLED REJECTION');
  process.exit(1);
});

export default app;