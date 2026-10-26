import { createPlaybackGrant } from '../media/transcoding/playback';
import { resourceResponse } from '../../utils/mediaResponse';
import { z } from 'zod';
import { Response } from 'express';
import { AuthRequest } from '../../middleware/authenticate';
import { prisma } from '../../config/database';
import { getPresignedDownloadUrl } from '../../utils/signedUrl';
import { env } from '../../config/env';
import { ok, notFound, badRequest, serverError } from '../../utils/response';

export async function getSession(req: AuthRequest, res: Response) {
  const userId = req.user!.id;
  const { id } = req.params;

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      recording: { include: { transcode: true } },
      resources: { include: { media: true }, orderBy: { orderIndex: 'asc' } },
    },
  });

  if (!session) return notFound(res);

  // Get prev/next sessions for navigation
  const siblings = await prisma.session.findMany({
    where: { masterclassId: session.masterclassId },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, orderIndex: true, title: true },
  });

  const currentIdx = siblings.findIndex((s) => s.id === id);
  const prevSession = currentIdx > 0 ? siblings[currentIdx - 1] : null;
  const nextSession = currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;

  // Get user progress
  const progress = await prisma.sessionProgress.findUnique({
    where: { userId_sessionId: { userId, sessionId: id } },
  });

  if (session.videoStorageKey && !env.S3_BUCKET) return serverError(res, 'Media storage is not configured');
  const recording = session.recording || (session.videoStorageKey ? await prisma.mediaLibrary.findUnique({ where: { storageKey: session.videoStorageKey }, include: { transcode: true } }) : null);
  const playback = recording?.fileType === 'video'
    ? await createPlaybackGrant(recording.id, userId, { sessionId: session.id })
    : { playbackUrl: recording?.fileType === 'audio' && session.videoStorageKey ? await getPresignedDownloadUrl(session.videoStorageKey, 900) : null, playbackUrlExpiresAt: recording?.fileType === 'audio' && session.videoStorageKey ? new Date(Date.now() + 900000).toISOString() : null, playbackType: recording?.fileType === 'audio' ? 'audio' : null, processingStatus: null };
  const { videoStorageKey: _key, videoMediaId: _mediaId, recording: _recording, ...safeSession } = session;

  return ok(res, {
    ...safeSession,
    durationSeconds: recording?.transcode?.durationSeconds ? Math.ceil(recording.transcode.durationSeconds) : session.durationSeconds,
    resources: await Promise.all(session.resources.map(resource => resourceResponse(resource, userId))),
    progress,
    prevSession,
    nextSession,
    ...playback,
  });
}

export async function updateProgress(req: AuthRequest, res: Response) {
  const userId = req.user!.id;
  const sessionId = req.params.id;
  const { lastWatchedSeconds, completed } = z.object({ lastWatchedSeconds: z.number().int().nonnegative().max(2147483647), completed: z.boolean().optional() }).strict().parse(req.body);

  if (typeof lastWatchedSeconds !== 'number' || lastWatchedSeconds < 0) {
    return badRequest(res, 'lastWatchedSeconds must be a non-negative number');
  }

  const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { durationSeconds: true, recording: { select: { transcode: { select: { durationSeconds: true } } } } } });
  const duration = session.recording?.transcode?.durationSeconds ?? session.durationSeconds;
  if (duration !== null && duration !== undefined && lastWatchedSeconds > Math.ceil(duration)) return badRequest(res, 'Progress exceeds session duration');
  const progress = await prisma.sessionProgress.upsert({
    where: { userId_sessionId: { userId, sessionId } },
    create: {
      userId,
      sessionId,
      lastWatchedSeconds,
      completedAt: completed ? new Date() : null,
    },
    update: {
      lastWatchedSeconds,
      ...(completed && { completedAt: new Date() }),
    },
  });

  return ok(res, progress);
}
