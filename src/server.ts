import app from './app';
import { env } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { emailQueue } from './jobs/email.queue';
import { logger } from './config/logger';
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API listening'));
server.requestTimeout = 120000;
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
  server.close(async () => {
    try { await emailQueue.close(); redis.disconnect(); await prisma.$disconnect(); clearTimeout(timer); process.exit(0); }
    catch { process.exit(1); }
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', () => shutdown('uncaughtException'));
process.on('unhandledRejection', () => shutdown('unhandledRejection'));
