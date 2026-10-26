import jwt from 'jsonwebtoken';
import { posix } from 'path';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../config/database';
import { s3 } from '../../../config/s3';
import { env } from '../../../config/env';
import { hasActiveAccess } from '../../../utils/access';
import { HttpError } from '../../../utils/httpError';
import { getPresignedDownloadUrl } from '../../../utils/signedUrl';
import { asyncHandler } from '../../../utils/asyncHandler';

export type PlaybackContext = { sessionId: string } | { resourceId: string };
const grantSchema = z.object({
  sub: z.string().min(1), mediaId: z.string().min(1), version: z.number().int(),
  context: z.union([z.object({ sessionId: z.string().min(1) }).strict(), z.object({ resourceId: z.string().min(1) }).strict()]),
  exp: z.number(),
});

// Re-check both the current attachment and entitlement. A copied link cannot bypass
// logout, an expired/refunded enrollment, or detaching a resource/recording.
export async function authorizePlayback(userId: string, mediaId: string, context: PlaybackContext, version?: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  if (!user || (version !== undefined && user.tokenVersion !== version)) throw new HttpError(401, 'Playback access was revoked');
  let masterclassId: string;
  if ('sessionId' in context) {
    const session = await prisma.session.findUnique({ where: { id: context.sessionId }, select: { masterclassId: true, videoMediaId: true, videoStorageKey: true } });
    if (!session) throw new HttpError(404, 'Session not found');
    const media = await prisma.mediaLibrary.findUnique({ where: { id: mediaId }, select: { storageKey: true } });
    if (!media || (session.videoMediaId !== mediaId && (session.videoMediaId || session.videoStorageKey !== media.storageKey))) throw new HttpError(403, 'Recording is no longer attached');
    masterclassId = session.masterclassId;
  } else {
    const resource = await prisma.resource.findUnique({ where: { id: context.resourceId }, include: { session: { select: { masterclassId: true } } } });
    if (!resource || resource.mediaId !== mediaId) throw new HttpError(403, 'Resource is no longer attached');
    const parent = resource.session?.masterclassId || resource.masterclassId;
    if (!parent) throw new HttpError(403, 'Resource has no course');
    masterclassId = parent;
  }
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_masterclassId: { userId, masterclassId } }, include: { payment: { select: { status: true } } } });
  if (!hasActiveAccess(enrollment)) throw new HttpError(403, 'An active enrollment is required');
  const seconds = Math.floor(((enrollment!.accessExpiresAt?.getTime() ?? (Date.now() + env.VIDEO_PLAYBACK_TTL_SECONDS * 1000)) - Date.now()) / 1000);
  if (seconds < 1) throw new HttpError(403, 'Enrollment has expired');
  return { version: user.tokenVersion, seconds: Math.min(env.VIDEO_PLAYBACK_TTL_SECONDS, seconds) };
}

export async function createPlaybackGrant(mediaId: string, userId: string, context: PlaybackContext) {
  const media = await prisma.mediaLibrary.findUnique({ where: { id: mediaId }, include: { transcode: true } });
  if (!media || media.deleting || media.isPublic || media.fileType !== 'video') throw new HttpError(404, 'Video not found');
  const access = await authorizePlayback(userId, mediaId, context);
  if (media.transcode?.status !== 'ready' || !media.transcode.outputPrefix) return { playbackUrl: null, playbackUrlExpiresAt: null, playbackType: 'hls', processingStatus: media.transcode?.status || 'not_queued' };
  const token = jwt.sign({ mediaId, context, version: access.version }, env.JWT_SECRET, {
    algorithm: 'HS256', audience: 'video-playback', subject: userId, expiresIn: access.seconds,
  });
  return {
    playbackUrl: assetUrl(mediaId, 'master.m3u8', token),
    playbackUrlExpiresAt: new Date(Date.now() + access.seconds * 1000).toISOString(),
    playbackType: 'hls', processingStatus: 'ready',
  };
}

export function assetUrl(mediaId: string, asset: string, token: string) {
  return `${env.API_PUBLIC_URL.replace(/\/$/, '')}/v1/playback/${encodeURIComponent(mediaId)}/${asset}?token=${encodeURIComponent(token)}`;
}

export function validAssetPath(asset: string) {
  return /^(master\.m3u8|\d+p\/(index\.m3u8|segment_\d{6,}\.ts))$/.test(asset);
}

export function rewritePlaylist(text: string, mediaId: string, playlist: string, token: string) {
  if (!text.startsWith('#EXTM3U') || Buffer.byteLength(text) > 1024 * 1024) throw new HttpError(502, 'Invalid video playlist');
  const rewrite = (reference: string) => {
    // Reject external URLs, traversal, query injection and unexpected files.
    if (!/^[a-zA-Z0-9_./-]+$/.test(reference) || reference.startsWith('/') || reference.split('/').includes('..')) throw new HttpError(502, 'Invalid video playlist');
    const asset = posix.join(posix.dirname(playlist), reference);
    if (!validAssetPath(asset)) throw new HttpError(502, 'Invalid video playlist');
    return assetUrl(mediaId, asset, token);
  };
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${rewrite(uri)}"`);
    return rewrite(line.trim());
  }).join('\n');
}

export async function servePlaybackAsset(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (typeof req.query.token !== 'string') throw new HttpError(401, 'Playback token is required');
  const token = z.string().max(4096).parse(req.query.token);
  let grant: z.infer<typeof grantSchema>;
  try { grant = grantSchema.parse(jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: 'video-playback' })); }
  catch { throw new HttpError(401, 'Invalid or expired playback link'); }
  const asset = req.params[0];
  if (grant.mediaId !== req.params.mediaId || !validAssetPath(asset)) throw new HttpError(403, 'Invalid playback asset');
  const access = await authorizePlayback(grant.sub, grant.mediaId, grant.context, grant.version);
  const media = await prisma.mediaLibrary.findUnique({ where: { id: grant.mediaId }, include: { transcode: true } });
  if (!media || media.deleting || media.isPublic || media.transcode?.status !== 'ready' || !media.transcode.outputPrefix) throw new HttpError(409, 'Video is not ready');
  const prefix = media.transcode.outputPrefix;
  if (!/^transcoded\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/$/.test(prefix)) throw new HttpError(502, 'Invalid video output');
  const key = prefix + asset;
  if (asset.endsWith('.m3u8')) {
    if (!env.S3_BUCKET) throw new HttpError(503, 'Media storage is not configured');
    const object = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!object.Body || (object.ContentLength ?? 0) > 1024 * 1024) throw new HttpError(502, 'Invalid video playlist');
    // Bound actual bytes as well as the optional object metadata.
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new HttpError(502, 'Invalid video playlist');
      chunks.push(Buffer.from(chunk));
    }
    return res.type('application/vnd.apple.mpegurl').send(rewritePlaylist(Buffer.concat(chunks).toString('utf8'), grant.mediaId, asset, token));
  }
  // Video bytes go straight from private S3 to the browser; already-issued segment
  // links are bearer URLs for at most 60 seconds after the entitlement check.
  const seconds = Math.min(60, access.seconds, grant.exp - Math.floor(Date.now() / 1000));
  if (seconds < 1) throw new HttpError(401, 'Playback link expired');
  return res.redirect(302, await getPresignedDownloadUrl(key, seconds));
}

const router = Router();
router.get('/:mediaId/*', asyncHandler(servePlaybackAsset));
export default router;
