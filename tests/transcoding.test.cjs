const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync, readdirSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'c'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'd'.repeat(64);
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.S3_BUCKET = 'video-test';
process.env.S3_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-placeholder';
process.env.AWS_SECRET_ACCESS_KEY = 'test-placeholder';
process.env.API_PUBLIC_URL = 'https://api.example.test';
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = '';
process.env.RESEND_API_KEY = '';
process.env.S3_ENDPOINT = '';

// Local optional binaries are downloaded from the distributor linked by ffmpeg.org;
// CI installs FFmpeg through the operating system package manager.
const cache = resolve('.cache/ffmpeg/bin');
if (!process.env.FFMPEG_PATH && existsSync(cache)) {
  for (const directory of readdirSync(cache)) {
    const binary = join(cache, directory, 'bin', 'ffmpeg.exe');
    if (existsSync(binary)) { process.env.FFMPEG_PATH = binary; process.env.FFPROBE_PATH = join(cache, directory, 'bin', 'ffprobe.exe'); break; }
  }
}

const { prisma } = require('../dist/config/database');
const { s3 } = require('../dist/config/s3');
const { env } = require('../dist/config/env');
const playback = require('../dist/modules/media/transcoding/playback');
const encoder = require('../dist/modules/media/transcoding/ffmpeg');
const processor = require('../dist/modules/media/transcoding/processor');
const storage = require('../dist/modules/media/transcoding/storage');
after(() => prisma.$disconnect());

function mock(t, object, key, fn) { const previous = object[key]; object[key] = fn; t.after(() => { object[key] = previous; }); }
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, type(value) { this.contentType = value; return this; }, send(value) { this.body = value; return this; }, redirect(status, location) { this.status = status; this.location = location; return this; } };
}
function mediaFixture(status = 'ready') {
  return { id: 'media', storageKey: 'media/original.mov', fileType: 'video', isPublic: false, deleting: false, sizeBytes: 10n, transcode: { status, outputPrefix: status === 'ready' ? 'transcoded/media/attempt/' : null } };
}
function allow(t, media = mediaFixture()) {
  mock(t, prisma.user, 'findUnique', async () => ({ tokenVersion: 2 }));
  mock(t, prisma.mediaLibrary, 'findUnique', async () => media);
  mock(t, prisma.session, 'findUnique', async () => ({ masterclassId: 'course', videoMediaId: media.id, videoStorageKey: media.storageKey }));
  mock(t, prisma.enrollment, 'findUnique', async () => ({ accessExpiresAt: null, payment: { status: 'succeeded' } }));
}
function signedGrant(context = { sessionId: 'lesson' }, extra = {}) {
  return jwt.sign({ mediaId: 'media', context, version: 2, ...extra }, env.JWT_SECRET, { algorithm: 'HS256', audience: 'video-playback', subject: 'viewer', expiresIn: 3600 });
}
function request(token, asset = 'master.m3u8') { return { params: { mediaId: 'media', 0: asset }, query: { token } }; }

test('rendition ladder preserves aspect ratio, even sizes, and does not upscale', () => {
  const ladder = encoder.chooseRenditions({ width: 1920, height: 1080 });
  assert.deepEqual(ladder.map(r => r.height), [360, 720, 1080]);
  const small = encoder.chooseRenditions({ width: 320, height: 180 });
  assert.equal(small.length, 1);
  assert.deepEqual([small[0].width, small[0].height], [320, 180]);
  for (const r of encoder.chooseRenditions({ width: 7000, height: 1080 })) {
    assert.equal(r.width % 2, 0); assert.equal(r.height % 2, 0); assert.ok(r.width <= 1920);
    assert.ok(Math.abs(r.width / r.height - 7000 / 1080) < 0.08);
  }
});

test('FFmpeg uses argument arrays, restricted input protocols, and optional audio', () => {
  const args = encoder.renditionArguments('file;$(evil).mov', 'output', { videoIndex: 0 }, { width: 640, height: 360, bitrate: 800 });
  assert.ok(args.includes('file;$(evil).mov'));
  assert.ok(args.includes('file,pipe'));
  assert.ok(args.includes('0:a:0?'));
  assert.ok(args.includes('independent_segments'));
});

test('playlists rewrite both rendition and segment references without revealing S3 keys', () => {
  const master = playback.rewritePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n360p/index.m3u8\n', 'media', 'master.m3u8', 'token');
  assert.ok(master.includes('https://api.example.test/v1/playback/media/360p/index.m3u8?token=token'));
  const child = playback.rewritePlaylist('#EXTM3U\nsegment_000001.ts\n', 'media', '360p/index.m3u8', 'token');
  assert.ok(child.includes('/360p/segment_000001.ts?token=token'));
  for (const malicious of ['https://evil.example/video.ts', '../../private.ts', '/absolute.ts', 'segment_000001.ts?evil=yes']) {
    assert.throws(() => playback.rewritePlaylist('#EXTM3U\n' + malicious, 'media', '360p/index.m3u8', 'token'), /Invalid video playlist/);
  }
  assert.equal(playback.validAssetPath('../original.mov'), false);
  assert.equal(playback.validAssetPath('360p/segment_000000.ts'), true);
});

test('ready videos get viewer-scoped HLS grants and pending videos expose no source', async t => {
  const media = mediaFixture(); allow(t, media);
  const ready = await playback.createPlaybackGrant('media', 'viewer', { sessionId: 'lesson' });
  assert.equal(ready.processingStatus, 'ready'); assert.equal(ready.playbackType, 'hls');
  assert.equal(ready.playbackUrl.includes('original.mov'), false);
  const decoded = jwt.verify(new URL(ready.playbackUrl).searchParams.get('token'), env.JWT_SECRET, { audience: 'video-playback' });
  assert.equal(decoded.sub, 'viewer'); assert.equal(decoded.mediaId, 'media'); assert.equal(decoded.version, 2);
  media.transcode.status = 'processing'; media.transcode.outputPrefix = null;
  const waiting = await playback.createPlaybackGrant('media', 'viewer', { sessionId: 'lesson' });
  assert.equal(waiting.playbackUrl, null); assert.equal(waiting.processingStatus, 'processing');
});

test('non-enrolled, expired, refunded, revoked and detached viewers cannot play', async t => {
  allow(t);
  for (const enrollment of [null, { accessExpiresAt: new Date(0), payment: { status: 'succeeded' } }, { accessExpiresAt: null, payment: { status: 'refunded' } }]) {
    prisma.enrollment.findUnique = async () => enrollment;
    await assert.rejects(playback.servePlaybackAsset(request(signedGrant()), response()), error => error.status === 403);
  }
  prisma.enrollment.findUnique = async () => ({ accessExpiresAt: null, payment: { status: 'succeeded' } });
  prisma.user.findUnique = async () => ({ tokenVersion: 3 });
  await assert.rejects(playback.servePlaybackAsset(request(signedGrant()), response()), error => error.status === 401);
  prisma.user.findUnique = async () => ({ tokenVersion: 2 });
  prisma.session.findUnique = async () => ({ masterclassId: 'course', videoMediaId: 'different', videoStorageKey: 'other.mov' });
  await assert.rejects(playback.servePlaybackAsset(request(signedGrant()), response()), error => error.status === 403);
});

test('playback rejects tampered, expired and wrong-audience tokens before storage', async t => {
  mock(t, s3, 'send', async () => assert.fail('Unverified storage read'));
  const expired = jwt.sign({ mediaId: 'media', context: { sessionId: 'lesson' }, version: 2 }, env.JWT_SECRET, { audience: 'video-playback', subject: 'viewer', expiresIn: -1 });
  const accessToken = jwt.sign({ sub: 'viewer', role: 'owner' }, env.JWT_SECRET);
  for (const token of ['bad', expired, accessToken]) await assert.rejects(playback.servePlaybackAsset(request(token), response()), error => error.status === 401);
  await assert.rejects(playback.servePlaybackAsset(request(signedGrant(), '../original.mov'), response()), error => error.status === 403);
});

test('HLS manifest request rechecks access and signs all child references', async t => {
  allow(t);
  mock(t, s3, 'send', async command => {
    assert.equal(command.input.Key, 'transcoded/media/attempt/master.m3u8');
    return { Body: Readable.from([Buffer.from('#EXTM3U\n360p/index.m3u8\n')]), ContentLength: 31 };
  });
  const res = response(); await playback.servePlaybackAsset(request(signedGrant()), res);
  assert.equal(res.contentType, 'application/vnd.apple.mpegurl');
  assert.ok(res.body.includes('/360p/index.m3u8?token='));
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('segment redirects expire in at most 60 seconds and cannot access originals', async t => {
  allow(t);
  mock(t, s3, 'send', async () => assert.fail('Segment should redirect directly to S3'));
  const res = response(); await playback.servePlaybackAsset(request(signedGrant(), '360p/segment_000001.ts'), res);
  assert.equal(res.status, 302);
  const url = new URL(res.location);
  assert.equal(url.pathname, '/transcoded/media/attempt/360p/segment_000001.ts');
  assert.ok(Number(url.searchParams.get('X-Amz-Expires')) <= 60);
});

test('playback grants are capped by enrollment expiration', async t => {
  allow(t);
  mock(t, prisma.enrollment, 'findUnique', async () => ({ accessExpiresAt: new Date(Date.now() + 15000), payment: { status: 'succeeded' } }));
  const grant = await playback.createPlaybackGrant('media', 'viewer', { sessionId: 'lesson' });
  const token = jwt.decode(new URL(grant.playbackUrl).searchParams.get('token'));
  assert.ok(token.exp - token.iat <= 15);
});

test('video resource grants validate its course and current media attachment', async t => {
  allow(t);
  mock(t, prisma.resource, 'findUnique', async () => ({ mediaId: 'media', masterclassId: 'course' }));
  const resource = { id: 'resource', mediaId: 'media', media: mediaFixture() };
  const { resourceResponse } = require('../dist/utils/mediaResponse');
  const result = await resourceResponse(resource, 'viewer');
  assert.equal(result.media.playbackType, 'hls'); assert.ok(result.media.url.includes('/v1/playback/'));
  assert.equal(result.media.storageKey, undefined);
  prisma.resource.findUnique = async () => ({ mediaId: 'other', masterclassId: 'course' });
  await assert.rejects(playback.createPlaybackGrant('media', 'viewer', { resourceId: 'resource' }), error => error.status === 403);
});

test('private video serialization never exposes its original URL to members', async () => {
  const { mediaResponse } = require('../dist/modules/media/media.service');
  const result = await mediaResponse(mediaFixture());
  assert.equal(result.url, null); assert.equal(result.storageKey, undefined); assert.equal(result.transcode, undefined);
});

function jobFixture(attempts = 1) {
  return { id: 'job', mediaId: 'media', leaseToken: 'attempt', status: 'processing', outputPrefix: null, attempts, media: mediaFixture() };
}
function fakeProcessor(t) {
  mock(t, processor.processorDependencies, 'downloadSource', async () => {});
  mock(t, processor.processorDependencies, 'transcodeVideo', async () => ({ info: { durationSeconds: 2, width: 640, height: 360 }, renditions: [{ name: '360p', width: 640, height: 360, bitrate: 800 }] }));
  mock(t, processor.processorDependencies, 'uploadOutput', async () => {});
  mock(t, processor.processorDependencies, 'deleteTranscodePrefix', async () => {});
}

test('job publishes readiness only after every S3 output upload completes', async t => {
  fakeProcessor(t); const states = []; let uploaded = false;
  mock(t, processor.processorDependencies, 'uploadOutput', async () => { uploaded = true; });
  mock(t, prisma.videoTranscode, 'updateMany', async args => {
    states.push(args.data.status);
    if (args.data.status === 'ready') { assert.equal(uploaded, true); assert.equal(args.where.leaseToken, 'attempt'); assert.equal(args.data.leaseToken, null); }
    return { count: 1 };
  });
  await processor.processVideoJob(jobFixture(), new AbortController().signal);
  assert.ok(states.includes('ready'));
});

test('failed encodes clean partial output and retry without publishing readiness', async t => {
  fakeProcessor(t); let cleaned = false; let final;
  mock(t, processor.processorDependencies, 'transcodeVideo', async () => { throw new encoder.TranscodeError('INVALID_VIDEO'); });
  mock(t, processor.processorDependencies, 'deleteTranscodePrefix', async () => { cleaned = true; });
  mock(t, prisma.videoTranscode, 'updateMany', async args => { final = args.data; assert.notEqual(args.data.status, 'ready'); return { count: 1 }; });
  await processor.processVideoJob(jobFixture(), new AbortController().signal);
  assert.equal(cleaned, true); assert.equal(final.status, 'queued'); assert.equal(final.errorCode, 'INVALID_VIDEO');
  assert.ok(final.availableAt > new Date());
});

test('attempt limit marks failure and missing leases cannot publish output', async t => {
  fakeProcessor(t); let final;
  mock(t, processor.processorDependencies, 'transcodeVideo', async () => { throw new encoder.TranscodeError('INVALID_VIDEO'); });
  mock(t, prisma.videoTranscode, 'updateMany', async args => { final = args.data; return { count: 1 }; });
  await processor.processVideoJob(jobFixture(env.VIDEO_TRANSCODE_ATTEMPTS), new AbortController().signal);
  assert.equal(final.status, 'failed');
  await assert.rejects(processor.processVideoJob({ ...jobFixture(), leaseToken: null }, new AbortController().signal), /LEASE_LOST/);
});

test('an uncertain publish commit cannot delete already-published video output', async t => {
  fakeProcessor(t);
  mock(t, processor.processorDependencies, 'deleteTranscodePrefix', async () => assert.fail('Published output was deleted'));
  mock(t, prisma.videoTranscode, 'updateMany', async args => {
    if (args.data.status === 'ready') throw new Error('Connection lost after commit');
    return { count: 1 };
  });
  mock(t, prisma.videoTranscode, 'findUnique', async () => ({ status: 'ready', outputPrefix: 'transcoded/media/attempt/' }));
  await processor.processVideoJob(jobFixture(), new AbortController().signal);
});

test('an unavailable database defers cleanup when publication outcome is unknown', async t => {
  fakeProcessor(t);
  mock(t, processor.processorDependencies, 'deleteTranscodePrefix', async () => assert.fail('Uncertain output was deleted'));
  mock(t, prisma.videoTranscode, 'updateMany', async args => {
    if (args.data.status === 'ready') throw new Error('Connection lost');
    return { count: 1 };
  });
  mock(t, prisma.videoTranscode, 'findUnique', async () => { throw new Error('Database unavailable'); });
  await processor.processVideoJob(jobFixture(), new AbortController().signal);
});

test('lost leases stop processing before reading source or publishing', async t => {
  fakeProcessor(t);
  mock(t, processor.processorDependencies, 'downloadSource', async () => assert.fail('Lost lease processed source'));
  mock(t, prisma.videoTranscode, 'updateMany', async args => { assert.notEqual(args.data.status, 'ready'); return { count: 0 }; });
  await processor.processVideoJob(jobFixture(), new AbortController().signal);
});

test('database job claiming uses row locks and a unique renewable lease', async t => {
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma, '$queryRaw', async query => { assert.ok(query.sql.includes('SKIP LOCKED')); return [{ id: 'job' }]; });
  mock(t, prisma.videoTranscode, 'findUniqueOrThrow', async () => ({ id: 'job', attempts: 0 }));
  mock(t, prisma.videoTranscode, 'update', async args => {
    assert.equal(args.data.status, 'processing');
    assert.deepEqual(args.data.attempts, { increment: 1 });
    assert.match(args.data.leaseToken, /^[a-f0-9-]{36}$/);
    assert.ok(args.data.lockedUntil > new Date());
    return { ...jobFixture(), ...args.data };
  });
  assert.equal((await processor.claimVideoJob()).status, 'processing');
});

test('deleting a ready video removes encoded outputs before its original', async t => {
  const { deleteMedia } = require('../dist/modules/media/media.controller');
  const media = mediaFixture();
  const events = [];
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma, '$queryRaw', async () => []);
  mock(t, prisma.mediaLibrary, 'findUnique', async () => media);
  mock(t, prisma.resource, 'count', async () => 0);
  mock(t, prisma.session, 'count', async () => 0);
  mock(t, prisma.videoTranscode, 'findUnique', async () => ({ id: 'job', ...media.transcode }));
  mock(t, prisma.videoTranscode, 'update', async () => ({}));
  mock(t, prisma.mediaLibrary, 'update', async () => ({ ...media, deleting: true }));
  mock(t, storage, 'deleteTranscodePrefix', async prefix => { assert.equal(prefix, media.transcode.outputPrefix); events.push('encoded'); });
  mock(t, s3, 'send', async command => { assert.equal(command.constructor.name, 'DeleteObjectCommand'); events.push('source'); return {}; });
  mock(t, prisma.mediaLibrary, 'delete', async () => { events.push('database'); return {}; });
  const res = { status() { return this; }, json() { return this; } };
  await deleteMedia({ params: { id: 'media' } }, res);
  assert.deepEqual(events, ['encoded', 'source', 'database']);
});

test('admin retry resets failed jobs but does not replace ready outputs', async t => {
  const { queueTranscode } = require('../dist/modules/media/media.controller');
  const media = mediaFixture(); let status = 'failed';
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma, '$queryRaw', async () => []);
  mock(t, prisma.mediaLibrary, 'findUnique', async () => media);
  mock(t, prisma.videoTranscode, 'upsert', async () => ({ id: 'job', status }));
  mock(t, prisma.videoTranscode, 'update', async args => { assert.equal(args.data.attempts, 0); assert.equal(args.data.status, 'queued'); return { status: 'queued' }; });
  const res = { status() { return this; }, json(body) { this.body = body; return this; } };
  await queueTranscode({ params: { id: 'media' }, body: {} }, res);
  assert.equal(res.body.data.status, 'queued');
  status = 'ready';
  await assert.rejects(queueTranscode({ params: { id: 'media' }, body: {} }, res), error => error.status === 409);
});

test('storage cleanup is scoped to an exact attempt prefix', async t => {
  mock(t, s3, 'send', async () => assert.fail('Unsafe cleanup contacted S3'));
  for (const prefix of ['', 'media/', 'transcoded/', '../', 'transcoded/media/']) await assert.rejects(storage.deleteTranscodePrefix(prefix), /INVALID_OUTPUT_PREFIX/);
});

test('source-size changes are rejected before downloading data', async t => {
  mock(t, s3, 'send', async command => {
    assert.equal(command.constructor.name, 'HeadObjectCommand');
    return { ContentLength: 11 };
  });
  await assert.rejects(storage.downloadSource('source', 10n, 'unused', new AbortController().signal), /SOURCE_SIZE_MISMATCH/);
});

const hasFfmpeg = spawnSync(env.FFMPEG_PATH, ['-version'], { windowsHide: true }).status === 0 && spawnSync(env.FFPROBE_PATH, ['-version'], { windowsHide: true }).status === 0;
test('real FFmpeg encodes an uploaded-format fixture into playable adaptive HLS', { skip: !hasFfmpeg && 'Install FFmpeg/ffprobe or configure FFMPEG_PATH/FFPROBE_PATH', timeout: 120000 }, async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'wilson-transcode-test-'));
  const signal = new AbortController().signal;
  try {
    const source = join(root, 'input; video.mp4');
    await encoder.runProcess(env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-t', '1.5', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source], signal, 30000);
    const out = join(root, 'hls');
    const result = await encoder.transcodeVideo(source, out, signal);
    assert.deepEqual(result.renditions.map(r => r.name), ['360p', '720p']);
    const files = await encoder.outputFiles(out);
    assert.ok(files.some(f => f.relative === 'master.m3u8'));
    for (const rendition of result.renditions) {
      assert.ok(files.some(f => f.relative.startsWith(rendition.name + '/') && f.relative.endsWith('.ts')));
      const manifest = await fs.readFile(join(out, rendition.name, 'index.m3u8'), 'utf8');
      assert.ok(manifest.includes('#EXT-X-ENDLIST'));
      await encoder.runProcess(env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-i', join(out, rendition.name, 'index.m3u8'), '-t', '0.1', '-f', 'null', '-'], signal, 30000);
    }
    const silent = join(root, 'silent.mp4');
    await encoder.runProcess(env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15', '-t', '0.5', '-c:v', 'libx264', '-threads', '2', silent], signal, 30000);
    const small = await encoder.transcodeVideo(silent, join(root, 'silent-hls'), signal);
    assert.deepEqual([small.renditions[0].width, small.renditions[0].height], [160, 90]);
    const untrusted = join(root, 'uploaded-playlist.bin');
    await fs.writeFile(untrusted, '#EXTM3U\n#EXTINF:1,\nhttps://example.invalid/source.ts\n');
    await assert.rejects(encoder.probeVideo(untrusted, signal));
  } finally {
    const safe = resolve(root);
    assert.ok(safe.startsWith(resolve(tmpdir()) + sep) && safe.split(sep).pop().startsWith('wilson-transcode-test-'));
    await fs.rm(safe, { recursive: true, force: true });
  }
});
