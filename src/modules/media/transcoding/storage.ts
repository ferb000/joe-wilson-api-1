import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../../config/s3';
import { env } from '../../../config/env';
import { outputFiles, TranscodeError } from './ffmpeg';

export async function downloadSource(key: string, expectedBytes: bigint, filename: string, signal: AbortSignal) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { abortSignal: signal });
  if (head.ContentLength === undefined || BigInt(head.ContentLength) !== expectedBytes || head.ContentLength > env.S3_MAX_UPLOAD_BYTES) throw new TranscodeError('SOURCE_SIZE_MISMATCH');
  const object = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { abortSignal: signal });
  if (!object.Body) throw new TranscodeError('SOURCE_UNAVAILABLE');
  let received = 0;
  const guard = new Transform({ transform(chunk, _encoding, next) {
    received += chunk.length;
    next(received > Number(expectedBytes) ? new TranscodeError('SOURCE_SIZE_MISMATCH') : null, chunk);
  } });
  await pipeline(object.Body as Readable, guard, createWriteStream(filename, { flags: 'wx' }), { signal });
  if (BigInt(received) !== expectedBytes) throw new TranscodeError('SOURCE_SIZE_MISMATCH');
}

export async function uploadOutput(directory: string, prefix: string, signal: AbortSignal) {
  const files = await outputFiles(directory);
  if (!files.length || files.reduce((total, file) => total + file.size, 0) > env.VIDEO_MAX_OUTPUT_BYTES) throw new TranscodeError('OUTPUT_LIMIT_EXCEEDED');
  // Publish master last; database readiness is set only after every object is durable.
  const rank = (name: string) => name === 'master.m3u8' ? 2 : name.endsWith('.m3u8') ? 1 : 0;
  files.sort((a, b) => rank(a.relative) - rank(b.relative));
  for (const file of files) {
    if (signal.aborted) throw new TranscodeError('ABORTED');
    if (!/^(master\.m3u8|\d+p\/(index\.m3u8|segment_\d{6,}\.ts))$/.test(file.relative)) throw new TranscodeError('INVALID_OUTPUT');
    const body = createReadStream(file.path);
    try {
      await s3.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET, Key: prefix + file.relative, Body: body,
        ContentLength: file.size, ContentType: file.relative.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        CacheControl: 'private, no-store',
      }), { abortSignal: signal });
    } finally { body.destroy(); }
  }
}

export async function deleteTranscodePrefix(prefix: string) {
  if (!/^transcoded\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/$/.test(prefix)) throw new TranscodeError('INVALID_OUTPUT_PREFIX');
  // List the first page repeatedly: deletion changes continuation positions.
  while (true) {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(30000) });
    const objects = (page.Contents || []).filter(object => object.Key?.startsWith(prefix)).map(object => ({ Key: object.Key! }));
    if (!objects.length) return;
    const deleted = await s3.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: objects, Quiet: true } }), { abortSignal: AbortSignal.timeout(30000) });
    if (deleted.Errors?.length) throw new TranscodeError('STORAGE_CLEANUP_FAILED');
  }
}
