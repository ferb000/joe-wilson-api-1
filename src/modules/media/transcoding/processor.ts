import { randomUUID } from 'crypto';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { Prisma, VideoTranscode, MediaLibrary } from '@prisma/client';
import { prisma } from '../../../config/database';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { outputFiles, transcodeVideo, TranscodeError } from './ffmpeg';
import { downloadSource, uploadOutput, deleteTranscodePrefix } from './storage';

export const LEASE_MS = 90000;
export type ClaimedJob = VideoTranscode & { media: MediaLibrary };

export async function claimVideoJob(): Promise<ClaimedJob | null> {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT t.id FROM video_transcodes t JOIN media_library m ON m.id = t."mediaId"
      WHERE NOT m.deleting AND NOT m."isPublic" AND m."fileType" = 'video'
      AND ((t.status = 'queued' AND t."availableAt" <= NOW()) OR (t.status = 'processing' AND t."lockedUntil" < NOW()))
      ORDER BY t."availableAt" LIMIT 1 FOR UPDATE OF t SKIP LOCKED
    `);
    if (!rows[0]) return null;
    const existing = await tx.videoTranscode.findUniqueOrThrow({ where: { id: rows[0].id } });
    if (existing.attempts >= env.VIDEO_TRANSCODE_ATTEMPTS) {
      await tx.videoTranscode.update({ where: { id: existing.id }, data: { status: 'failed', errorCode: 'ATTEMPTS_EXHAUSTED', leaseToken: null, lockedUntil: null } });
      return null;
    }
    return tx.videoTranscode.update({
      where: { id: existing.id },
      data: { status: 'processing', attempts: { increment: 1 }, leaseToken: randomUUID(), lockedUntil: new Date(Date.now() + LEASE_MS), errorCode: null },
      include: { media: true },
    });
  });
}

// Injection allows exercising job/storage failures without touching live infrastructure.
export const processorDependencies = { downloadSource, transcodeVideo, uploadOutput, deleteTranscodePrefix };

export async function processVideoJob(job: ClaimedJob, shutdownSignal: AbortSignal) {
  if (!job.leaseToken) throw new TranscodeError('LEASE_LOST');
  const abort = new AbortController();
  const shutdown = () => abort.abort();
  shutdownSignal.addEventListener('abort', shutdown, { once: true });
  if (shutdownSignal.aborted) abort.abort();
  const prefix = `transcoded/${job.mediaId}/${job.leaseToken}/`;
  let root: string | undefined;
  let output: string | undefined;
  let checking = false;
  let heartbeatFailed = false;
  let previousCleaned = !job.outputPrefix;
  let publishing = false;
  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const renewed = await prisma.videoTranscode.updateMany({
        where: { id: job.id, leaseToken: job.leaseToken, status: 'processing', media: { deleting: false } },
        data: { lockedUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (renewed.count !== 1) throw new TranscodeError('LEASE_LOST');
      const size = output ? (await outputFiles(output)).reduce((sum, file) => sum + file.size, 0) : 0;
      if (size > env.VIDEO_MAX_OUTPUT_BYTES) throw new TranscodeError('OUTPUT_LIMIT_EXCEEDED');
    } catch { heartbeatFailed = true; abort.abort(); }
    finally { checking = false; }
  }, 15000);
  const timeout = setTimeout(() => abort.abort(), env.VIDEO_TRANSCODE_TIMEOUT_SECONDS * 1000);
  try {
    if (!env.S3_BUCKET) throw new TranscodeError('STORAGE_NOT_CONFIGURED');
    root = await mkdtemp(join(tmpdir(), 'wilson-transcode-'));
    output = join(root, 'output');
    await mkdir(output);
    // A crashed attempt may have uploaded incomplete objects; its prefix is never reused.
    if (job.outputPrefix) { await processorDependencies.deleteTranscodePrefix(job.outputPrefix); previousCleaned = true; }
    const reserved = await prisma.videoTranscode.updateMany({ where: { id: job.id, leaseToken: job.leaseToken, status: 'processing', media: { deleting: false } }, data: { outputPrefix: prefix } });
    if (reserved.count !== 1) throw new TranscodeError('LEASE_LOST');
    const source = join(root, 'source.bin');
    await processorDependencies.downloadSource(job.media.storageKey, job.media.sizeBytes, source, abort.signal);
    const result = await processorDependencies.transcodeVideo(source, output, abort.signal);
    await processorDependencies.uploadOutput(output, prefix, abort.signal);
    if (abort.signal.aborted) throw new TranscodeError('ABORTED');
    publishing = true;
    const ready = await prisma.videoTranscode.updateMany({
      where: { id: job.id, leaseToken: job.leaseToken, status: 'processing', media: { deleting: false } },
      data: { status: 'ready', outputPrefix: prefix, durationSeconds: result.info.durationSeconds, width: result.info.width, height: result.info.height, renditions: result.renditions as unknown as Prisma.InputJsonValue, leaseToken: null, lockedUntil: null, errorCode: null },
    });
    if (ready.count !== 1) { publishing = false; throw new TranscodeError('LEASE_LOST'); }
    logger.info({ transcodeId: job.id }, 'Video transcoding completed');
  } catch (error) {
    if (publishing) {
      // A network error can hide a successful database commit. Never delete
      // published output, or delete when the commit outcome cannot be verified.
      try {
        const current = await prisma.videoTranscode.findUnique({ where: { id: job.id } });
        if (current?.status === 'ready' && current.outputPrefix === prefix) return;
      } catch {
        logger.warn({ transcodeId: job.id }, 'Video publication outcome requires reconciliation');
        return;
      }
    }
    // Keep the prefix on the job until cleanup succeeds; deletion/retry can recover it.
    let cleaned = false;
    try { await processorDependencies.deleteTranscodePrefix(prefix); cleaned = previousCleaned; }
    catch { logger.error({ transcodeId: job.id }, 'Transcode output cleanup requires retry'); }
    const code = heartbeatFailed ? 'LEASE_LOST' : error instanceof TranscodeError ? error.code : 'TRANSCODE_FAILED';
    const retry = job.attempts < env.VIDEO_TRANSCODE_ATTEMPTS;
    await prisma.videoTranscode.updateMany({
      where: { id: job.id, leaseToken: job.leaseToken, status: 'processing' },
      data: { status: retry ? 'queued' : 'failed', errorCode: code, leaseToken: null, lockedUntil: null, availableAt: new Date(Date.now() + Math.min(300000, 30000 * 2 ** (job.attempts - 1))), ...(cleaned && { outputPrefix: null }) },
    });
    logger.warn({ transcodeId: job.id, code }, 'Video transcoding attempt failed');
  } finally {
    clearInterval(heartbeat); clearTimeout(timeout);
    shutdownSignal.removeEventListener('abort', shutdown);
    // Only remove the exact directory allocated for this attempt.
    if (root) {
      const safeRoot = resolve(root);
      if (safeRoot.startsWith(resolve(tmpdir()) + sep) && safeRoot.split(sep).pop()?.startsWith('wilson-transcode-')) {
        await rm(safeRoot, { recursive: true, force: true }).catch(() => logger.error({ transcodeId: job.id }, 'Temporary video files require cleanup'));
      }
    }
  }
}
