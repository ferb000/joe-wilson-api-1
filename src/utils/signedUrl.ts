import { HttpError } from './httpError';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from '../config/s3';
import { env } from '../config/env';

export async function getPresignedDownloadUrl(storageKey: string, expiresIn = 900): Promise<string> {
  if (!env.S3_BUCKET) throw new HttpError(503, 'Media storage is not configured');
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: storageKey,
  });
  return getSignedUrl(s3, command, { expiresIn });
}
