const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wilson-local-storage-'));
Object.assign(process.env, { NODE_ENV: 'development', STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIRECTORY: path.join(directory, '.local-storage'), DATABASE_URL: 'postgresql://test:test@localhost:5432/test', JWT_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), REDIS_ENABLED: 'false', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', RESEND_API_KEY: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', S3_BUCKET: '' });
const commands = require('@aws-sdk/client-s3');
process.env.FRONTEND_URLS = 'http://localhost:3000,http://localhost:5174';
process.env.CORS_ORIGINS = '';
const { storage, s3 } = require('../dist/config/s3');
const { localObjectPath } = require('../dist/modules/media/local.storage');
const { localFileUrl } = require('../dist/modules/media/local.files.routes');
const router = require('../dist/modules/media/local.files.routes').default;
const { errorHandler } = require('../dist/middleware/errorHandler');
after(() => {
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'wilson-local-storage-'));
  fs.rmSync(resolved, { recursive: true, force: true }); s3.destroy();
});
test('local keys reject traversal, Windows paths, empty segments and absolute paths', () => {
  for (const key of ['../outside', '/absolute', 'media/../secret', 'media\\file', 'C:/file', 'media//file', 'media/./file']) assert.throws(() => localObjectPath(key), /Invalid file key/);
  assert.ok(localObjectPath('media/uuid/lesson.mp4').startsWith(directory));
});
test('local filesystem upload/read/delete needs no AWS configuration', async () => {
  const Key = 'media/test/notes.txt';
  await storage.send(new commands.PutObjectCommand({ Key, Body: Buffer.from('Hello local files'), ContentType: 'text/plain' }));
  const head = await storage.send(new commands.HeadObjectCommand({ Key })); assert.equal(head.ContentLength, 17); assert.equal(head.ContentType, 'text/plain');
  const object = await storage.send(new commands.GetObjectCommand({ Key })); const chunks = []; for await (const chunk of object.Body) chunks.push(chunk); assert.equal(Buffer.concat(chunks).toString(), 'Hello local files');
  await storage.send(new commands.DeleteObjectCommand({ Key })); await assert.rejects(storage.send(new commands.HeadObjectCommand({ Key })), e => e.$metadata.httpStatusCode === 404);
});
test('local multipart upload CORS permits configured frontend origins', async () => {
  const app = require('../dist/app').default;
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/local-files/part?token=grant`;
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5174', 'Access-Control-Request-Method': 'PUT' },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5174');
    assert.match(response.headers.get('access-control-allow-methods'), /PUT/);
    const unlisted = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://unlisted.example', 'Access-Control-Request-Method': 'PUT' },
    });
    assert.equal(unlisted.headers.get('access-control-allow-origin'), null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('HTTP multipart links, signed downloads, ranges and public images work without exposing the storage directory', async () => {
  const express = require('express'); const app = express(); app.use('/v1/local-files', router); app.use(errorHandler);
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const atServer = url => base + new URL(url).pathname + new URL(url).search;
  const Key = 'media/multipart/video.mp4';
  try {
    const upload = await storage.send(new commands.CreateMultipartUploadCommand({ Key, ContentType: 'video/mp4' }));
    const grant = atServer(localFileUrl(Key, 900, { uploadId: upload.UploadId, partNumber: 1 }));
    assert.equal((await fetch(base + '/v1/local-files/part', { method: 'PUT', body: 'private' })).status, 401);
    assert.equal((await fetch(grant, { method: 'PUT', body: '0123456789' })).status, 200);
    const second = atServer(localFileUrl(Key, 900, { uploadId: upload.UploadId, partNumber: 2 }));
    assert.equal((await fetch(second, { method: 'PUT', body: 'abcdef' })).status, 200);
    const parts = await storage.send(new commands.ListPartsCommand({ Key, UploadId: upload.UploadId })); assert.equal(parts.Parts[0].Size, 10); assert.equal(parts.Parts.length, 2);
    await storage.send(new commands.CompleteMultipartUploadCommand({ Key, UploadId: upload.UploadId, MultipartUpload: { Parts: parts.Parts } }));
    assert.equal((await fetch(base + '/v1/local-files/private')).status, 401);
    assert.equal((await fetch(atServer(localFileUrl(Key, -1)))).status, 401);
    assert.equal((await fetch(grant)).status, 404);
    assert.equal((await fetch(grant, { method: 'PUT', body: 'after-completion' })).status, 404);
    const read = atServer(localFileUrl(Key, 60)); const response = await fetch(read, { headers: { Range: 'bytes=2-5' } });
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin'); assert.equal(response.status, 206); assert.equal(await response.text(), '2345'); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await fetch(base + '/v1/local-files/public/media/multipart/video.mp4')).status, 404);
    await storage.send(new commands.PutObjectCommand({ Key: 'public/image/cover.png', Body: Buffer.from('image'), ContentType: 'image/png' }));
    assert.equal((await fetch(base + '/v1/local-files/public/image/cover.png')).status, 200);
    assert.equal((await fetch(base + '/.local-storage/objects/' + Key)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('local transcode cleanup deletes only the exact output prefix', async () => {
  const prefix = 'transcoded/media/attempt/';
  for (const Key of [prefix + 'master.m3u8', prefix + '360p/index.m3u8', 'transcoded/media/other/master.m3u8']) await storage.send(new commands.PutObjectCommand({ Key, Body: 'playlist' }));
  await require('../dist/modules/media/transcoding/storage').deleteTranscodePrefix(prefix);
  await assert.rejects(storage.send(new commands.HeadObjectCommand({ Key: prefix + 'master.m3u8' })));
  assert.ok(await storage.send(new commands.HeadObjectCommand({ Key: 'transcoded/media/other/master.m3u8' })));
});
test('production rejects local storage configuration before starting', () => {
  assert.throws(() => execFileSync(process.execPath, ['-e', "require('./dist/config/env')"], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe' }), /Command failed/);
});
