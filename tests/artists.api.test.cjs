// Dedicated PostgreSQL integration database only; never set this to a live DB.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const dbUrl = process.env.TEST_DATABASE_URL;
assert.ok(dbUrl, 'Set TEST_DATABASE_URL to a disposable database named joe_artists_test');
assert.match(new URL(dbUrl).pathname, /^\/joe_artists_test(?:_[a-zA-Z0-9_-]+)?$/, 'Refusing to test against a non-test database');
process.env.DATABASE_URL = dbUrl;
process.env.DIRECT_URL = dbUrl;
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe', env: process.env });
require('ts-node/register');
const express = require('express');
global.prisma = new (require('@prisma/client').PrismaClient)({ log: [] });
const { prisma } = require('../src/config/database');
const { publicArtistsRouter, adminArtistsRouter } = require('../src/modules/artists/artists.routes');
const { signAccessToken } = require('../src/utils/jwt');
const { parseYouTubeId } = require('../src/modules/artists/youtube');

const suffix = randomUUID().slice(0, 8);
let owner, token, server, base;
let requestCount = 0;
const publicBase = '/v1/artists';
const adminBase = '/v1/admin/artists';
async function request(path, method = 'GET', data, auth = token) {
  requestCount++;
  const response = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' }, ...(data !== undefined && { body: JSON.stringify(data) }) });
  const payload = response.status === 204 ? null : await response.json();
  return { status: response.status, retryAfter: response.headers.get('retry-after'), ...payload };
}
async function expect(path, method, data, status = 200, auth = token) {
  const result = await request(path, method, data, auth);
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}

test('Artist REST API and YouTube admin-to-public integration', async t => {
  owner = await prisma.user.create({ data: { email: `artists-test-${suffix}@example.com`, passwordHash: 'test-only', firstName: 'Test', lastName: 'Owner', role: 'owner' } });
  token = signAccessToken({ sub: owner.id, email: owner.email, role: 'owner' });
  const app = express();
  app.use(express.json());
  app.use(publicBase, publicArtistsRouter);
  app.use(adminBase, adminArtistsRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await prisma.artist.deleteMany({ where: { slug: { endsWith: suffix } } });
    await prisma.artistCountry.deleteMany({ where: { name: { endsWith: suffix } } });
    await prisma.artistRegion.deleteMany({ where: { slug: { endsWith: suffix } } });
    await prisma.artistGenre.deleteMany({ where: { slug: { endsWith: suffix } } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  });
  let region, country, genre, artist, otherArtist, project, video, credit, thumbnail;
  const artistPath = () => `${adminBase}/${artist.id}`;
  const projectPath = () => `${artistPath()}/projects/${project.id}`;
  const publicProject = () => `${publicBase}/${artist.id}/projects/${project.id}`;
  const videoPath = () => `${projectPath()}/videos/${video.id}`;

  await t.test('Owner authentication: missing, forged, expired, member and demoted tokens', async () => {
    await expect(adminBase, 'GET', undefined, 401, null);
    await expect(adminBase, 'GET', undefined, 401, 'invalid-token');
    const expired = require('jsonwebtoken').sign({ sub: owner.id, email: owner.email, role: 'owner', type: 'access' }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: 'mr-wilson-api', audience: 'mr-wilson-api', expiresIn: -1 });
    await expect(adminBase, 'GET', undefined, 401, expired);
    const member = signAccessToken({ sub: owner.id, email: owner.email, role: 'member' });
    await expect(adminBase, 'POST', {}, 403, member);
    await prisma.user.update({ where: { id: owner.id }, data: { role: 'member' } });
    await expect(adminBase, 'GET', undefined, 403);
    await prisma.user.update({ where: { id: owner.id }, data: { role: 'owner' } });
  });

  await t.test('Region, country and genre CRUD; safe FK conflicts; public filter metadata', async () => {
    region = (await expect(`${adminBase}/regions`, 'POST', { name: `Test Region ${suffix}`, slug: `region-${suffix}` }, 201)).data;
    country = (await expect(`${adminBase}/countries`, 'POST', { name: `Test Country ${suffix}`, code: 'ZZ', regionId: region.id }, 201)).data;
    genre = (await expect(`${adminBase}/genres`, 'POST', { name: `Test Genre ${suffix}`, slug: `genre-${suffix}` }, 201)).data;
    for (const [kind, record] of [['regions', region], ['countries', country], ['genres', genre]]) {
      await expect(`${adminBase}/${kind}`, 'GET');
      await expect(`${adminBase}/${kind}/${record.id}`, 'GET');
      await expect(`${adminBase}/${kind}/${record.id}`, 'PATCH', { orderIndex: 2 });
      await expect(`${publicBase}/${kind}`, 'GET', undefined, 200, null);
      await expect(`${publicBase}/${kind}/${record.id}`, 'GET', undefined, 200, null);
    }
    await expect(`${adminBase}/regions`, 'POST', { name: region.name, slug: region.slug }, 409);
    await expect(`${adminBase}/regions/${region.id}`, 'DELETE', undefined, 409);
    await expect(`${adminBase}/countries`, 'POST', { name: 'Bad FK', code: 'XY', regionId: randomUUID() }, 409);
    const filters = (await expect(`${publicBase}/filters`, 'GET', undefined, 200, null)).data;
    assert.ok(filters.regions.some(r => r.id === region.id));
    await expect(`${adminBase}/filters`, 'GET');
  });

  await t.test('Artist CRUD, strict validation, pagination and combined filtering', async () => {
    const data = { name: `Artist ${suffix}`, slug: `artist-${suffix}`, countryId: country.id, genreId: genre.id };
    artist = (await expect(adminBase, 'POST', data, 201)).data;
    otherArtist = (await expect(adminBase, 'POST', { ...data, name: 'Other', slug: `other-${suffix}`, isPublished: true }, 201)).data;
    await expect(`${publicBase}/${artist.id}`, 'GET', undefined, 404, null);
    await expect(`${artistPath()}`, 'PATCH', { isPublished: true });
    for (const query of ['page=0', 'limit=101', 'page=abc', 'page=1.5', 'country[x]=bad', 'isPublished=false']) await expect(`${publicBase}?${query}`, 'GET', undefined, 400, null);
    await expect(adminBase, 'POST', { ...data, unexpected: true }, 400);
    await expect(artistPath(), 'PATCH', {}, 400);
    await expect(`${adminBase}/not-a-uuid`, 'GET', undefined, 400);
    await expect(`${adminBase}/${randomUUID()}`, 'PATCH', { name: 'Missing' }, 404);
    const combined = await expect(`${publicBase}?region=${encodeURIComponent(region.name)}&country=${encodeURIComponent(country.name)}&genre=${genre.slug}&limit=1&page=2`, 'GET', undefined, 200, null);
    assert.equal(combined.meta.total, 2);
    assert.equal(combined.meta.page, 2);
    assert.equal(combined.data.length, 1);
    const none = await expect(`${publicBase}?regionId=${randomUUID()}`, 'GET', undefined, 200, null);
    assert.equal(none.data.length, 0);
    await expect(`${adminBase}/genres/${genre.id}`, 'DELETE', undefined, 409);
  });

  await t.test('Projects, videos, thumbnails and credits: all CRUD routes, scoped to parents', async () => {
    project = (await expect(`${artistPath()}/projects`, 'POST', { title: 'Live project', isPublished: true }, 201)).data;
    video = (await expect(`${projectPath()}/videos`, 'POST', { youtubeUrl: 'https://youtu.be/WMbSq-QrBVU?t=10', isPublished: true }, 201)).data;
    assert.equal(video.youtubeId, 'WMbSq-QrBVU');
    assert.equal(video.thumbnailUrl, 'https://i.ytimg.com/vi/WMbSq-QrBVU/hqdefault.jpg');
    credit = (await expect(`${projectPath()}/credits`, 'POST', { role: 'Bass guitar' }, 201)).data;
    thumbnail = (await expect(`${videoPath()}/thumbnails`, 'POST', { url: 'https://example.com/thumbnail.jpg', altText: 'Live artist' }, 201)).data;
    for (const [path, record] of [[`${artistPath()}/projects`, project], [`${projectPath()}/videos`, video], [`${projectPath()}/credits`, credit], [`${videoPath()}/thumbnails`, thumbnail]]) {
      await expect(path, 'GET');
      await expect(`${path}/${record.id}`, 'GET');
      await expect(`${path}/${record.id}`, 'PATCH', { orderIndex: 1 });
      await expect(path.replace(adminBase, publicBase), 'GET', undefined, 200, null);
      await expect(`${path}/${record.id}`.replace(adminBase, publicBase), 'GET', undefined, 200, null);
    }
    await expect(`${adminBase}/${otherArtist.id}/projects/${project.id}`, 'PATCH', { title: 'Stolen' }, 404);
    await expect(`${adminBase}/${otherArtist.id}/projects/${project.id}/videos/${video.id}`, 'DELETE', undefined, 404);
    await expect(`${videoPath()}/thumbnails/${randomUUID()}`, 'DELETE', undefined, 404);
    const publicArtist = (await expect(`${publicBase}/${artist.id}`, 'GET', undefined, 200, null)).data;
    assert.equal(publicArtist.region, region.name);
    assert.equal(publicArtist.projects[0].role, 'Bass guitar');
    assert.equal(publicArtist.projects[0].youtubeId, video.youtubeId);
  });

  await t.test('Custom cover override, removal, URL edits and multiple videos flow through to frontend contract', async () => {
    await expect(videoPath(), 'PATCH', { customCoverUrl: 'https://example.com/custom.jpg' });
    let published = (await expect(publicProject(), 'GET', undefined, 200, null)).data;
    assert.equal(published.thumbnailUrl, 'https://example.com/custom.jpg');
    await expect(`${videoPath()}/thumbnails/${thumbnail.id}`, 'DELETE', undefined, 204);
    await expect(videoPath(), 'PATCH', { youtubeUrl: 'https://www.youtube.com/shorts/CVLX3GN6Y2E', customCoverUrl: null });
    published = (await expect(publicProject(), 'GET', undefined, 200, null)).data;
    assert.equal(published.youtubeId, 'CVLX3GN6Y2E');
    assert.equal(published.thumbnailUrl, 'https://i.ytimg.com/vi/CVLX3GN6Y2E/hqdefault.jpg');
    const extra = (await expect(`${projectPath()}/videos`, 'POST', { youtubeUrl: 'https://www.youtube.com/watch?v=hqkKCjdfbgo&list=test', isPublished: true, orderIndex: 2 }, 201)).data;
    published = (await expect(publicProject(), 'GET', undefined, 200, null)).data;
    assert.equal(published.videos.length, 2);
    await expect(`${projectPath()}/videos/${extra.id}`, 'DELETE', undefined, 204);
  });

  await t.test('URL validation rejects unsafe hosts, protocols, malformed IDs and mass assignment', async () => {
    for (const youtubeUrl of ['https://evil.com/watch?v=WMbSq-QrBVU', 'https://youtube.com.evil.com/watch?v=WMbSq-QrBVU', 'javascript:alert(1)', 'https://youtube.com/playlist?list=x', 'https://youtu.be/short', 'https://user:pw@youtube.com/watch?v=WMbSq-QrBVU']) {
      await expect(`${projectPath()}/videos`, 'POST', { youtubeUrl }, 400);
    }
    await expect(`${projectPath()}/videos`, 'POST', {}, 400);
    await expect(videoPath(), 'PATCH', { youtubeUrl: 'https://youtu.be/WMbSq-QrBVU', youtubeId: 'CVLX3GN6Y2E' }, 400);
    await expect(videoPath(), 'PATCH', { customCoverUrl: 'javascript:alert(1)' }, 400);
    await expect(videoPath(), 'PATCH', { projectId: randomUUID() }, 400);
    for (const url of ['https://www.youtube.com/watch?v=WMbSq-QrBVU', 'https://youtu.be/WMbSq-QrBVU', 'https://youtube.com/shorts/WMbSq-QrBVU', 'https://m.youtube.com/watch?v=WMbSq-QrBVU', 'https://youtube.com/live/WMbSq-QrBVU']) assert.equal(parseYouTubeId(url), 'WMbSq-QrBVU');
  });

  await t.test('Draft content never leaks through lists, detail or nested public endpoints', async () => {
    await expect(videoPath(), 'PATCH', { isPublished: false });
    await expect(publicProject(), 'GET', undefined, 404, null);
    assert.equal((await expect(`${publicBase}/${artist.id}`, 'GET', undefined, 200, null)).data.projects.length, 0);
    await expect(videoPath(), 'PATCH', { isPublished: true });
    await expect(projectPath(), 'PATCH', { isPublished: false });
    await expect(`${publicProject()}/credits`, 'GET', undefined, 404, null);
    await expect(projectPath(), 'PATCH', { isPublished: true });
    await expect(artistPath(), 'PATCH', { isPublished: false });
    await expect(`${publicBase}/${artist.id}/projects`, 'GET', undefined, 404, null);
    await expect(artistPath(), 'PATCH', { isPublished: true });
  });

  await t.test('Slug routing, artist-scoped project slugs, related details and project filtering', async () => {
    const slugArtist = `${publicBase}/${artist.slug}`;
    assert.equal((await expect(slugArtist, 'GET', undefined, 200, null)).data.id, artist.id);
    const slugDetail = `${slugArtist}/projects/${project.slug}`;
    const detail = (await expect(slugDetail, 'GET', undefined, 200, null)).data;
    assert.equal(detail.id, project.id);
    assert.equal((await expect(`${slugArtist}/projects/${project.id}`, 'GET', undefined, 200, null)).data.id, project.id);
    assert.equal((await expect(`${publicBase}/${artist.id}/projects/${project.slug}`, 'GET', undefined, 200, null)).data.id, project.id);
    assert.equal(detail.artist.id, artist.id);
    assert.equal(detail.artist.slug, artist.slug);
    assert.ok(detail.youtubeUrl.includes(detail.youtubeId));
    assert.ok(detail.embedUrl.includes(detail.youtubeId));
    assert.equal(detail.links.self, slugDetail);
    assert.equal((await expect(detail.links.self, 'GET', undefined, 200, null)).data.id, project.id);
    await expect(`${slugDetail}/videos`, 'GET', undefined, 200, null);
    await expect(`${slugDetail}/videos/${video.id}`, 'GET', undefined, 200, null);
    await expect(`${slugDetail}/credits/${credit.id}`, 'GET', undefined, 200, null);
    await expect(`${slugArtist}/projects?q=no-such-project`, 'GET', undefined, 200, null).then(r => { assert.deepEqual(r.data, []); assert.equal(r.meta.total, 0); });
    assert.equal((await expect(`${slugArtist}/projects?credit=Bass%20guitar`, 'GET', undefined, 200, null)).meta.total, 1);
    await expect(`${slugArtist}/projects?isPublished=false`, 'GET', undefined, 400, null);
    await expect(`${slugArtist}/projects?limit=abc`, 'GET', undefined, 400, null);
    await expect(`${publicBase}/bad_slug!`, 'GET', undefined, 400, null);
    await expect(`${publicBase}/missing-${suffix}`, 'GET', undefined, 404, null);
    await expect(`${slugArtist}/projects/missing-project`, 'GET', undefined, 404, null);
    await expect(`${adminBase}/${artist.slug}`, 'GET', undefined, 400);
    await expect(adminBase, 'POST', { name: 'Reserved', slug: 'filters', countryId: country.id, genreId: genre.id }, 400);

    const related = (await expect(`${artistPath()}/projects`, 'POST', { title: 'Related published', slug: 'related-published', isPublished: true, orderIndex: 2 }, 201)).data;
    await expect(`${artistPath()}/projects/${related.id}/videos`, 'POST', { youtubeId: 'WMbSq-QrBVU', isPublished: true }, 201);
    await expect(`${artistPath()}/projects`, 'POST', { title: 'Duplicate slug', slug: related.slug }, 409);
    await expect(`${artistPath()}/projects/${related.id}`, 'PATCH', { slug: project.slug }, 409);
    const another = (await expect(`${adminBase}/${otherArtist.id}/projects`, 'POST', { title: 'Other artist', slug: related.slug, isPublished: true }, 201)).data;
    await expect(`${adminBase}/${otherArtist.id}/projects/${another.id}/videos`, 'POST', { youtubeId: 'WMbSq-QrBVU', isPublished: true }, 201);
    assert.equal((await expect(`${publicBase}/${otherArtist.slug}/projects/${another.slug}`, 'GET', undefined, 200, null)).data.id, another.id);
    await expect(`${publicBase}/${otherArtist.slug}/projects/${project.slug}`, 'GET', undefined, 404, null);

    const draft = (await expect(`${artistPath()}/projects`, 'POST', { title: 'Draft candidate' }, 201)).data;
    await expect(`${artistPath()}/projects/${draft.id}/videos`, 'POST', { youtubeId: 'WMbSq-QrBVU', isPublished: true }, 201);
    const noPlayableVideo = (await expect(`${artistPath()}/projects`, 'POST', { title: 'No published video', isPublished: true }, 201)).data;
    await expect(`${artistPath()}/projects/${noPlayableVideo.id}/videos`, 'POST', { youtubeId: 'WMbSq-QrBVU' }, 201);
    let result = await expect(`${slugDetail}/related?limit=1`, 'GET', undefined, 200, null);
    assert.equal(result.meta.total, 1);
    assert.equal(result.data[0].id, related.id);
    assert.equal((await expect(slugDetail, 'GET', undefined, 200, null)).data.relatedProjects[0].id, related.id);
    result = await expect(`${slugDetail}/related?page=2&limit=1`, 'GET', undefined, 200, null);
    assert.deepEqual(result.data, []);
    assert.equal(result.meta.total, 1);
    assert.deepEqual((await expect(`${slugDetail}/related?q=not-found`, 'GET', undefined, 200, null)).data, []);
    await expect(`${slugArtist}/projects/${draft.slug}`, 'GET', undefined, 404, null);
    await expect(`${slugArtist}/projects/${draft.slug}/related`, 'GET', undefined, 404, null);
    await expect(`${slugArtist}/projects/${noPlayableVideo.slug}/related`, 'GET', undefined, 404, null);
    await expect(`${artistPath()}/projects`, 'POST', { title: 'Invalid slug', slug: randomUUID() }, 400);
    await expect(`${adminBase}/${otherArtist.id}/projects/${project.id}/related`, 'GET', undefined, 404);
    await expect(`${slugDetail}/related?isPublished=false`, 'GET', undefined, 400, null);
    await expect(projectPath(), 'PATCH', { description: 'Full project description', title: 'Renamed project' });
    const renamed = (await expect(slugDetail, 'GET', undefined, 200, null)).data;
    assert.equal(renamed.slug, project.slug);
    assert.equal(renamed.description, 'Full project description');
    await expect(projectPath(), 'PATCH', { title: project.title });
    const duplicateTitle = (await expect(`${artistPath()}/projects`, 'POST', { title: project.title }, 201)).data;
    assert.notEqual(duplicateTitle.slug, project.slug);
    for (const record of [related, draft, noPlayableVideo, duplicateTitle]) await expect(`${artistPath()}/projects/${record.id}`, 'DELETE', undefined, 204);
    await expect(`${adminBase}/${otherArtist.id}/projects/${another.id}`, 'DELETE', undefined, 204);
    assert.deepEqual((await expect(`${slugDetail}/related`, 'GET', undefined, 200, null)).data, []);
    await expect(artistPath(), 'PATCH', { isPublished: false });
    await expect(slugArtist, 'GET', undefined, 404, null);
    await expect(`${slugDetail}/related`, 'GET', undefined, 404, null);
    await expect(artistPath(), 'PATCH', { isPublished: true });
  });

  await t.test('Consistent validation and safe transient/internal error responses', async () => {
    const invalid = await expect(`${publicBase}?limit=0`, 'GET', undefined, 400, null);
    assert.equal(invalid.success, false);
    assert.equal(typeof invalid.error, 'string');
    assert.ok(invalid.details.length);
    const original = prisma.artist.findMany;
    try {
      prisma.artist.findMany = () => { throw new Error('internal-error-test-do-not-expose'); };
      const failure = await expect(publicBase, 'GET', undefined, 500, null);
      assert.equal(failure.success, false);
      assert.ok(!JSON.stringify(failure).includes('internal-error-test-do-not-expose'));
      prisma.artist.findMany = () => { throw new (require('@prisma/client').Prisma.PrismaClientInitializationError)('temporary database failure', '5.22.0', 'P1001'); };
      const unavailable = await expect(publicBase, 'GET', undefined, 503, null);
      assert.equal(unavailable.success, false);
      assert.match(unavailable.error, /temporarily unavailable/);
      assert.equal(unavailable.retryAfter, '5');
    } finally { prisma.artist.findMany = original; }
    await expect(publicBase, 'GET', undefined, 200, null);
  });

  await t.test('Deletes and cascades clean dependent records; taxonomy delete routes work', async () => {
    await expect(`${projectPath()}/credits/${credit.id}`, 'DELETE', undefined, 204);
    await expect(videoPath(), 'DELETE', undefined, 204);
    await expect(projectPath(), 'DELETE', undefined, 204);
    await expect(artistPath(), 'DELETE', undefined, 204);
    const cascadeProject = (await expect(`${adminBase}/${otherArtist.id}/projects`, 'POST', { title: 'Cascade test' }, 201)).data;
    const cascadeVideo = (await expect(`${adminBase}/${otherArtist.id}/projects/${cascadeProject.id}/videos`, 'POST', { youtubeId: 'WMbSq-QrBVU' }, 201)).data;
    await expect(`${adminBase}/${otherArtist.id}/projects/${cascadeProject.id}/videos/${cascadeVideo.id}/thumbnails`, 'POST', { url: 'https://example.com/cascade.jpg', altText: 'Cascade' }, 201);
    await expect(`${adminBase}/${otherArtist.id}/projects/${cascadeProject.id}/credits`, 'POST', { role: 'Producer' }, 201);
    await expect(`${adminBase}/${otherArtist.id}`, 'DELETE', undefined, 204);
    assert.equal(await prisma.artistVideo.count({ where: { projectId: cascadeProject.id } }), 0);
    assert.equal(await prisma.artistCredit.count({ where: { projectId: cascadeProject.id } }), 0);
    assert.equal(await prisma.artistThumbnail.count({ where: { videoId: cascadeVideo.id } }), 0);
    for (const [kind, record] of [['countries', country], ['regions', region], ['genres', genre]]) await expect(`${adminBase}/${kind}/${record.id}`, 'DELETE', undefined, 204);
  });
  t.diagnostic(`${requestCount} HTTP assertions completed against PostgreSQL.`);
});
