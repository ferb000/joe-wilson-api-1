import { Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import { createRedisConnection } from '../config/redis';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { emailQueue } from './email.queue';
import { sendEmail } from '../utils/email';
import { logger } from '../config/logger';
const connection = createRedisConnection(true);
const emailWorker = new Worker('emailQueue', async job => {
  const { to, subject, html } = job.data;
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof html !== 'string') throw new Error('Invalid email job');
  await sendEmail(to, subject, html);
}, { connection, concurrency: 5 });
let pumping = false;
export async function pumpOutbox() {
  if (pumping) return;
  pumping = true;
  try {
    await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; to: string; subject: string; html: string }[]>(Prisma.sql`SELECT id, "to", subject, html FROM email_outbox WHERE "enqueuedAt" IS NULL ORDER BY "createdAt" LIMIT 25 FOR UPDATE SKIP LOCKED`);
      for (const row of rows) {
        await emailQueue.add('send', { to: row.to, subject: row.subject, html: row.html }, { jobId: row.id });
        await tx.emailOutbox.update({ where: { id: row.id }, data: { enqueuedAt: new Date() } });
      }
    }, { timeout: 15000 });
  } catch { logger.error('Email outbox dispatch failed; will retry'); }
  finally { pumping = false; }
}
const timer = setInterval(() => void pumpOutbox(), 5000);
void pumpOutbox();
emailWorker.on('failed', job => logger.error({ jobId: job?.id }, 'Email delivery failed'));
emailWorker.on('error', () => logger.error('Email worker connection failed'));
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true; clearInterval(timer);
  const force = setTimeout(() => process.exit(1), 20000); force.unref();
  await emailWorker.close(); await emailQueue.close(); connection.disconnect(); redis.disconnect(); await prisma.$disconnect(); clearTimeout(force);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
export default emailWorker;
