import { MediaLibrary, Resource } from '@prisma/client';
import { HttpError } from './httpError';
import { createPlaybackGrant, authorizePlayback } from '../modules/media/transcoding/playback';
import { mediaResponse } from '../modules/media/media.service';
export async function resourceResponse(resource: Resource & { media: MediaLibrary }, userId?: string) {
  if (!userId) throw new HttpError(401, 'Resource access requires an authenticated viewer');
  const access = await authorizePlayback(userId, resource.mediaId, { resourceId: resource.id });
  const media = await mediaResponse(resource.media, false, Math.min(900, access.seconds));
  if (resource.media.fileType === 'video') {
    if (!userId) throw new Error('Resource playback requires an authenticated viewer');
    const playback = await createPlaybackGrant(resource.mediaId, userId, { resourceId: resource.id });
    return { ...resource, media: { ...media, url: playback.playbackUrl, ...playback } };
  }
  return { ...resource, media };
}
