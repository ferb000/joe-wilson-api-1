const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgresql://review:review@localhost:5432/review';
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.S3_BUCKET = 'review-bucket';
process.env.S3_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'review-placeholder';
process.env.AWS_SECRET_ACCESS_KEY = 'review-placeholder';
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = '';
process.env.RESEND_API_KEY = '';
process.env.S3_ENDPOINT = '';
const { prisma } = require('../dist/config/database');
const { validate } = require('../dist/middleware/validate');
const schemas = require('../dist/modules/auth/auth.schema');
const auth = require('../dist/modules/auth/auth.service');
const jwt = require('../dist/utils/jwt');
const { authenticate } = require('../dist/middleware/authenticate');
const { asyncHandler } = require('../dist/utils/asyncHandler');
const { errorHandler } = require('../dist/middleware/errorHandler');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const user = { id: 'member', email: 'member@example.com', firstName: 'Member', lastName: 'User', role: 'member', tokenVersion: 0, avatarUrl: null, emailVerified: false, createdAt: new Date() };
function response() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }
function mock(t, target, key, fn) { const old = target[key]; target[key] = fn; t.after(() => { target[key] = old; }); }
after(() => prisma.$disconnect());

test('profile rejects role and service cannot forward hidden fields', async t => {
  assert.equal(schemas.updateProfileSchema.safeParse({ role: 'owner' }).success, false);
  mock(t, prisma.user, 'update', async args => {
    assert.deepEqual(args.data, { firstName: 'Changed' });
    return { ...user, firstName: 'Changed' };
  });
  await auth.updateProfile(user.id, { firstName: 'Changed', role: 'owner', passwordHash: 'bad' });
});

test('validation handles flat body, persists normalization, rejects unknown fields', () => {
  const req = { body: { email: ' MEMBER@EXAMPLE.COM ', password: 'Password123' } };
  let passed = false;
  validate(schemas.loginSchema)(req, response(), () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.body.email, 'member@example.com');
  const res = response();
  validate(schemas.registerSchema)({ body: { ...user, password: 'Password123' } }, res, () => assert.fail('Unexpected acceptance'));
  assert.equal(res.statusCode, 400);
  const inquiry = { body: { senderName: 'Review', message: 'Hello' } };
  validate(z.object({ senderName: z.string(), message: z.string() }))(inquiry, response(), () => {});
  assert.equal(inquiry.body.message, 'Hello');
});

test('login refresh token rotates once, rejects replay, and has expiry', async t => {
  const stored = { ...user, passwordHash: await bcrypt.hash('Password123', 4) };
  mock(t, prisma.user, 'findUnique', async () => ({ ...stored }));
  mock(t, prisma.user, 'update', async args => Object.assign(stored, args.data));
  mock(t, prisma.user, 'updateMany', async args => {
    if (args.where.passwordHash !== undefined) {
      if (args.where.passwordHash !== stored.passwordHash) return { count: 0 };
    } else if (args.where.refreshTokenHash !== stored.refreshTokenHash) return { count: 0 };
    Object.assign(stored, args.data); return { count: 1 };
  });
  const issued = await auth.login(stored.email, 'Password123');
  assert.equal(jwt.verifyRefreshToken(issued.refreshToken).sub, user.id);
  assert.ok(require('jsonwebtoken').decode(issued.refreshToken).exp);
  const rotated = await auth.refresh(issued.refreshToken);
  assert.notEqual(rotated.refreshToken, issued.refreshToken);
  await assert.rejects(auth.refresh(issued.refreshToken), /INVALID_TOKEN/);
  await auth.refresh(rotated.refreshToken);
});

test('concurrent refresh consumes token only once', async t => {
  const token = jwt.signRefreshToken({ sub: user.id });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  let consumed = false;
  mock(t, prisma.user, 'findUnique', async () => ({ ...user, refreshTokenHash: hash }));
  mock(t, prisma.user, 'updateMany', async () => { if (consumed) return { count: 0 }; consumed = true; return { count: 1 }; });
  const results = await Promise.allSettled([auth.refresh(token), auth.refresh(token)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('authentication rejects revoked access and uses current database role', async t => {
  const token = jwt.signAccessToken({ sub: user.id, email: user.email, role: 'owner', version: 0 });
  mock(t, prisma.user, 'findUnique', async () => ({ ...user }));
  const req = { headers: { authorization: `Bearer ${token}` } };
  await authenticate(req, response(), () => {});
  assert.equal(req.user.role, 'member');
  prisma.user.findUnique = async () => ({ ...user, tokenVersion: 1 });
  const res = response();
  await authenticate(req, res, () => assert.fail('Revoked token accepted'));
  assert.equal(res.statusCode, 401);
});

test('async failures reach error middleware and production responses omit internals', async () => {
  const express = require('express'); const app = express();
  app.get('/', asyncHandler(async () => { throw new Error('private database connection'); }));
  app.use(errorHandler);
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { success: false, error: 'Internal server error' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('registration binds both tokens to the created user', async t => {
  mock(t, prisma.user, 'findUnique', async () => null);
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma.user, 'create', async args => ({ ...user, ...args.data }));
  const result = await auth.register({ firstName: 'New', lastName: 'User', email: 'new@example.com', password: 'Password123' });
  assert.equal(jwt.verifyAccessToken(result.accessToken).sub, result.user.id);
  assert.equal(jwt.verifyRefreshToken(result.refreshToken).sub, result.user.id);
});

test('logout clears refresh state and increments access-token version', async t => {
  mock(t, prisma.user, 'update', async args => {
    assert.deepEqual(args.data, { refreshTokenHash: null, tokenVersion: { increment: 1 } });
    return user;
  });
  await auth.logout(user.id);
});

test('expired and refunded enrollments do not grant access', () => {
  const { hasActiveAccess } = require('../dist/utils/access');
  assert.equal(hasActiveAccess(null), false);
  assert.equal(hasActiveAccess({ accessExpiresAt: new Date(0), payment: { status: 'succeeded' } }), false);
  assert.equal(hasActiveAccess({ accessExpiresAt: null, payment: { status: 'refunded' } }), false);
  assert.equal(hasActiveAccess({ accessExpiresAt: null, payment: { status: 'succeeded' } }), true);
});

test('non-enrolled course responses omit resources and live links', async t => {
  const controller = require('../dist/modules/masterclasses/masterclasses.controller');
  mock(t, prisma.masterclass, 'findUnique', async () => ({ id: 'mc', isPublished: true, sessions: [], resources: [{ media: { storageKey: 'private.pdf', sizeBytes: 1n } }] }));
  mock(t, prisma.enrollment, 'findFirst', async () => null);
  mock(t, prisma.enrollment, 'findUnique', async () => null);
  mock(t, prisma.session, 'findMany', async () => [{ id: 'session', liveStreamUrl: 'https://private.example', videoStorageKey: 'recording.mp4', videoMediaId: 'media' }]);
  const req = { user, params: { id: 'mc' }, query: {} };
  const detail = response(); await controller.getMasterclass(req, detail);
  assert.deepEqual(detail.body.data.resources, []);
  assert.doesNotThrow(() => JSON.stringify(detail.body));
  const listing = response(); await controller.getMasterclassSessions(req, listing);
  assert.equal(listing.body.data[0].liveStreamUrl, undefined);
  assert.equal(listing.body.data[0].videoStorageKey, undefined);
});

test('protected resource response serializes sizes and hides object keys', async t => {
  mock(t, prisma.user, 'findUnique', async () => ({ tokenVersion: 0 }));
  mock(t, prisma.resource, 'findUnique', async () => ({ id: 'resource', mediaId: 'media', masterclassId: 'mc' }));
  mock(t, prisma.enrollment, 'findUnique', async () => ({ accessExpiresAt: null, payment: { status: 'succeeded' } }));
  const { resourceResponse } = require('../dist/utils/mediaResponse');
  const result = await resourceResponse({ id: 'resource', mediaId: 'media', media: { id: 'media', filename: 'lesson.mp4', storageKey: 'media/lesson.mp4', sizeBytes: 123n, isPublic: false, deleting: false } }, user.id);
  assert.equal(result.media.sizeBytes, '123');
  assert.equal(result.media.storageKey, undefined);
  assert.ok(new URL(result.media.url).searchParams.get('X-Amz-Signature'));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('multipart completion rejects missing, reordered-number, and oversized parts', () => {
  const { verifyUploadParts, PART_SIZE } = require('../dist/modules/media/media.controller');
  const valid = [{ PartNumber: 2, ETag: 'second', Size: 10 }, { PartNumber: 1, ETag: 'first', Size: PART_SIZE }];
  assert.doesNotThrow(() => verifyUploadParts(valid, PART_SIZE + 10));
  assert.throws(() => verifyUploadParts([{ PartNumber: 1, ETag: 'first', Size: PART_SIZE }], PART_SIZE + 10), /declared file size/);
  assert.throws(() => verifyUploadParts([{ PartNumber: 1, ETag: 'first', Size: 11 }], 10), /declared file size/);
  assert.throws(() => verifyUploadParts([{ PartNumber: 2, ETag: 'first', Size: 10 }], 10), /declared file size/);
});

test('media deletion refuses attached recordings before storage mutation', async t => {
  const { deleteMedia } = require('../dist/modules/media/media.controller');
  const { s3 } = require('../dist/config/s3');
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma, '$queryRaw', async () => []);
  mock(t, prisma.mediaLibrary, 'findUnique', async () => ({ id: 'media', storageKey: 'media/lesson.mp4', deleting: false }));
  mock(t, prisma.resource, 'count', async () => 0);
  mock(t, prisma.session, 'count', async () => 1);
  mock(t, s3, 'send', async () => assert.fail('Attached file deleted'));
  await assert.rejects(deleteMedia({ params: { id: 'media' } }, response()), /Detach/);
});

test('multipart completion verifies storage and creates its library record atomically', async t => {
  const { completeUpload } = require('../dist/modules/media/media.controller');
  const { s3 } = require('../dist/config/s3');
  const pending = { id: 'upload', uploadId: 'storage-upload', storageKey: 'media/lesson.mp4', filename: 'lesson.mp4', mimeType: 'video/mp4', sizeBytes: 10n, uploadedBy: user.id, isPublic: false, status: 'uploading', expiresAt: new Date(Date.now() + 60000) };
  let completed = false, registered = false, removed = false;
  mock(t, prisma.mediaUpload, 'findFirst', async () => pending);
  mock(t, prisma.mediaUpload, 'updateMany', async () => ({ count: 1 }));
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma.mediaLibrary, 'create', async args => { assert.equal(completed, true); assert.deepEqual(args.data.transcode, { create: {} }); registered = true; return { id: 'media', ...args.data }; });
  mock(t, prisma.mediaUpload, 'delete', async () => { assert.equal(registered, true); removed = true; return pending; });
  mock(t, s3, 'send', async command => {
    if (command.constructor.name === 'HeadObjectCommand') {
      if (!completed) throw Object.assign(new Error('Not found'), { $metadata: { httpStatusCode: 404 } });
      return { ContentLength: 10, ContentType: 'video/mp4' };
    }
    if (command.constructor.name === 'ListPartsCommand') return { Parts: [{ PartNumber: 1, ETag: 'part', Size: 10 }] };
    if (command.constructor.name === 'CompleteMultipartUploadCommand') { completed = true; return {}; }
    assert.fail('Unexpected storage operation');
  });
  const res = response(); await completeUpload({ user, params: { id: 'upload' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.fileType, 'video');
  assert.equal(res.body.data.sizeBytes, '10');
  assert.equal(removed, true);
});

test('disabled payments do not pretend checkout or refunds succeeded', async () => {
  const { createCheckout, stripeWebhook } = require('../dist/modules/payments/payments.controller');
  const { refundPayment } = require('../dist/modules/payments/admin.payments.controller');
  await assert.rejects(createCheckout({ body: {}, user }, response()), error => error.status === 503);
  await assert.rejects(stripeWebhook({ body: Buffer.from('{}'), headers: {} }, response()), error => error.status === 503);
  await assert.rejects(refundPayment({ params: { id: 'payment' } }, response()), error => error.status === 503);
});

test('payment events enroll once and full refunds revoke access', async t => {
  const { processPaymentEvent } = require('../dist/modules/payments/payments.controller');
  const seen = new Set();
  const payment = { id: 'payment', userId: user.id, masterclassId: 'mc', gatewayReference: 'pi_review', amountCents: 1000, currency: 'usd', status: 'pending' };
  let grants = 0, revokes = 0;
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma, '$queryRaw', async () => []);
  mock(t, prisma.paymentWebhookEvent, 'findUnique', async args => seen.has(args.where.id) ? { id: args.where.id } : null);
  mock(t, prisma.paymentWebhookEvent, 'create', async args => { seen.add(args.data.id); return args.data; });
  mock(t, prisma.payment, 'findFirst', async () => ({ ...payment }));
  mock(t, prisma.payment, 'findUniqueOrThrow', async () => ({ ...payment }));
  mock(t, prisma.payment, 'update', async args => Object.assign(payment, args.data));
  mock(t, prisma.enrollment, 'upsert', async () => { grants++; return {}; });
  mock(t, prisma.enrollment, 'deleteMany', async () => { revokes++; return { count: 1 }; });
  mock(t, prisma.user, 'findUniqueOrThrow', async () => user);
  mock(t, prisma.masterclass, 'findUniqueOrThrow', async () => ({ title: 'Lesson' }));
  const success = { id: 'evt_success', type: 'payment_intent.succeeded', data: { object: { object: 'payment_intent', id: 'pi_review', amount: 1000, amount_received: 1000, currency: 'usd', metadata: { paymentId: 'payment', userId: user.id, masterclassId: 'mc' } } } };
  await processPaymentEvent(success); await processPaymentEvent(success);
  assert.equal(grants, 1); assert.equal(payment.status, 'succeeded');
  await processPaymentEvent({ id: 'evt_refund', type: 'charge.refunded', data: { object: { object: 'charge', payment_intent: 'pi_review', amount: 1000, amount_refunded: 1000, refunded: true, currency: 'usd', metadata: {} } } });
  assert.equal(revokes, 1); assert.equal(payment.status, 'refunded');
  await processPaymentEvent({ ...success, id: 'evt_late_success' });
  assert.equal(grants, 1); assert.equal(payment.status, 'refunded');
});

test('payment amount mismatch does not grant access', async t => {
  const { processPaymentEvent } = require('../dist/modules/payments/payments.controller');
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma, '$queryRaw', async () => []);
  mock(t, prisma.paymentWebhookEvent, 'findUnique', async () => null);
  const payment = { id: 'payment', gatewayReference: 'pi_review', amountCents: 1000, currency: 'usd' };
  mock(t, prisma.payment, 'findFirst', async () => payment);
  mock(t, prisma.payment, 'findUniqueOrThrow', async () => payment);
  mock(t, prisma.enrollment, 'upsert', async () => assert.fail('Wrong amount granted access'));
  await assert.rejects(processPaymentEvent({ id: 'evt_bad', type: 'payment_intent.succeeded', data: { object: { object: 'payment_intent', id: 'pi_review', amount: 1, currency: 'usd', metadata: {} } } }), /amount or currency/);
});

test('pagination, progress, dates, and update schemas reject invalid values', () => {
  const { getPaginationParams } = require('../dist/utils/pagination');
  const { dateRange } = require('../dist/utils/dateRange');
  assert.throws(() => getPaginationParams({ page: 'nope' }), /positive integers/);
  assert.throws(() => getPaginationParams({ limit: '101' }), /maximum/);
  assert.deepEqual(getPaginationParams({ page: '2', limit: '10' }), { page: 2, limit: 10 });
  assert.throws(() => dateRange({ from: '2026-12-01', to: '2026-01-01' }), /before/);
  assert.throws(() => dateRange({ from: '2026-02-30' }));
  const { updateSchema } = require('../dist/modules/services/services.schema');
  assert.equal(updateSchema.safeParse({ isPublished: 'yes' }).success, false);
  assert.equal(updateSchema.safeParse({ id: 'replacement' }).success, false);
});

test('CSV escapes quotes and prevents formula interpretation', () => {
  const { csvCell } = require('../dist/utils/csv');
  assert.equal(csvCell('A "quoted" name'), '"A ""quoted"" name"');
  assert.equal(csvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(csvCell('  +cmd'), '"\'  +cmd"');
});

test('production docs require the configured token', () => {
  const { env } = require('../dist/config/env');
  const { docsAccess } = require('../dist/middleware/docsAccess');
  const previous = env.DOCS_TOKEN; env.DOCS_TOKEN = 'review-docs';
  const res = { statusCode: 0, setHeader() {}, sendStatus(n) { this.statusCode = n; } };
  try {
    docsAccess({ headers: {} }, res, () => assert.fail('Unauthenticated docs'));
    assert.equal(res.statusCode, 401);
    let passed = false;
    docsAccess({ headers: { authorization: 'Basic ' + Buffer.from('docs:review-docs').toString('base64') } }, res, () => { passed = true; });
    assert.equal(passed, true);
  } finally { env.DOCS_TOKEN = previous; }
});

test('HTML email content is escaped centrally', () => {
  const { escapeHtml } = require('../dist/utils/email');
  assert.equal(escapeHtml('<img src="x">&'), '&lt;img src=&quot;x&quot;&gt;&amp;');
});

test('email provider failures propagate so the worker can retry', async () => {
  const { sendEmail } = require('../dist/utils/email');
  await assert.rejects(sendEmail('review@example.com', 'Review', '<p>Review</p>', { emails: { send: async () => ({ error: { message: 'rejected' } }) } }), /rejected delivery/);
  await assert.rejects(sendEmail('review@example.com', 'Review', '<p>Review</p>', { emails: { send: async () => { throw new Error('Network unavailable'); } } }), /Network unavailable/);
});

test('notifications create an escaped durable outbox record', async () => {
  const { env } = require('../dist/config/env');
  const { sendWelcomeEmail } = require('../dist/utils/email');
  const previous = env.RESEND_API_KEY; env.RESEND_API_KEY = 'review-placeholder';
  let record;
  try {
    await sendWelcomeEmail('review@example.com', '<script>bad</script>', { emailOutbox: { create: async args => { record = args.data; } } });
    assert.equal(record.to, 'review@example.com');
    assert.ok(record.html.includes('&lt;script&gt;'));
    assert.equal(record.html.includes('<script>'), false);
  } finally { env.RESEND_API_KEY = previous; }
});

test('HTTP logs redact credentials and remove sensitive URL queries', async t => {
  const pino = require('pino');
  const config = require('../dist/config/logger');
  let log = '';
  mock(t, config, 'logger', pino(config.loggerOptions, { write(chunk) { log += chunk; } }));
  const path = require.resolve('../dist/middleware/logger'); delete require.cache[path];
  const { httpLogger } = require(path);
  const server = http.createServer((req, res) => httpLogger(req, res, () => res.end('ok')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/?token=QUERY_PLACEHOLDER`, { headers: { authorization: 'Bearer AUTH_PLACEHOLDER', cookie: 'COOKIE_PLACEHOLDER' } });
    await result.text();
    assert.equal(log.includes('AUTH_PLACEHOLDER'), false);
    assert.equal(log.includes('COOKIE_PLACEHOLDER'), false);
    assert.equal(log.includes('QUERY_PLACEHOLDER'), false);
    assert.ok(log.includes('[REDACTED]'));
  } finally { await new Promise(resolve => server.close(resolve)); delete require.cache[path]; }
});

test('checkout rejects capacity exhaustion without contacting provider', async t => {
  const config = require('../dist/config/stripe');
  const { createCheckout } = require('../dist/modules/payments/payments.controller');
  mock(t, config, 'getStripe', () => ({ paymentIntents: { create: async () => assert.fail('Full class charged') } }));
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma, '$queryRaw', async () => []);
  mock(t, prisma.masterclass, 'findUnique', async () => ({ isPublished: true, status: 'active', priceCents: 1000, maxEnrollments: 1 }));
  mock(t, prisma.enrollment, 'findUnique', async () => null);
  mock(t, prisma.enrollment, 'count', async () => 1);
  mock(t, prisma.payment, 'findFirst', async () => null);
  mock(t, prisma.payment, 'count', async () => 0);
  await assert.rejects(createCheckout({ body: { masterclassId: '11111111-1111-4111-8111-111111111111' }, user }, response()), error => error.status === 409);
});

test('refund requests do not mark records refunded before webhook confirmation', async t => {
  const config = require('../dist/config/stripe');
  const { refundPayment } = require('../dist/modules/payments/admin.payments.controller');
  mock(t, config, 'getStripe', () => ({ refunds: { create: async (input, options) => { assert.equal(input.amount, 1000); assert.equal(options.idempotencyKey, 'refund:payment'); return { id: 're_review', status: 'pending' }; } } }));
  mock(t, prisma.payment, 'findUnique', async () => ({ id: 'payment', status: 'succeeded', gatewayReference: 'pi_review', amountCents: 1000 }));
  mock(t, prisma.payment, 'update', async () => assert.fail('Refund status changed before confirmation'));
  const res = response(); await refundPayment({ params: { id: 'payment' } }, res);
  assert.equal(res.body.data.status, 'pending');
});

test('webhook rejects bad signatures before database writes', async t => {
  const config = require('../dist/config/stripe');
  const { stripeWebhook } = require('../dist/modules/payments/payments.controller');
  mock(t, config, 'getStripe', () => ({ webhooks: { constructEvent() { throw new Error('Invalid signature'); } } }));
  mock(t, prisma, '$transaction', async () => assert.fail('Unverified webhook processed'));
  await assert.rejects(stripeWebhook({ headers: { 'stripe-signature': 'bad' }, body: Buffer.from('{}') }, response()), error => error.status === 400);
});

test('progress rejects fractions and non-boolean completion', async () => {
  const { updateProgress } = require('../dist/modules/sessions/sessions.controller');
  await assert.rejects(updateProgress({ user, params: { id: 'session' }, body: { lastWatchedSeconds: 0.5 } }, response()));
  await assert.rejects(updateProgress({ user, params: { id: 'session' }, body: { lastWatchedSeconds: 1, completed: 'false' } }, response()));
});

test('login cannot create a session after concurrent password revocation', async t => {
  mock(t, prisma.user, 'findUnique', async () => ({ ...user, passwordHash: await bcrypt.hash('Password123', 4) }));
  mock(t, prisma.user, 'updateMany', async () => ({ count: 0 }));
  await assert.rejects(auth.login(user.email, 'Password123'), /INVALID_CREDENTIALS/);
});

test('application readiness reports dependency failures and inquiry routes validate real requests', async t => {
  const redisPath = require.resolve('../dist/config/redis');
  const ratePath = require.resolve('../dist/middleware/rateLimit');
  const appPath = require.resolve('../dist/app');
  const previousRedis = require.cache[redisPath], previousRate = require.cache[ratePath];
  let redisReady = true;
  require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: { redis: { ping: async () => { if (!redisReady) throw new Error('Unavailable'); return 'PONG'; } } } };
  const pass = (_req, _res, next) => next();
  require.cache[ratePath] = { id: ratePath, filename: ratePath, loaded: true, exports: { globalLimiter: pass, playbackLimiter: pass, authLimiter: pass, contactLimiter: pass } };
  delete require.cache[appPath];
  mock(t, prisma, '$queryRaw', async () => [{ value: 1 }]);
  mock(t, prisma, '$transaction', async fn => fn(prisma));
  mock(t, prisma.inquiry, 'create', async args => { assert.equal(args.data.status, undefined); return { id: 'inquiry', ...args.data }; });
  const app = require(appPath).default;
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/ready')).status, 200);
    redisReady = false;
    assert.equal((await fetch(base + '/ready')).status, 503);
    assert.equal((await fetch(base + '/health')).status, 200);
    const valid = await fetch(base + '/v1/inquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senderName: 'Review', senderEmail: 'REVIEW@EXAMPLE.COM', type: 'general', message: 'Hello', status: 'closed' }) });
    assert.equal(valid.status, 201);
    assert.equal((await valid.json()).data.id, 'inquiry');
    const invalid = await fetch(base + '/v1/inquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousRedis) require.cache[redisPath] = previousRedis; else delete require.cache[redisPath];
    if (previousRate) require.cache[ratePath] = previousRate; else delete require.cache[ratePath];
    delete require.cache[appPath];
  }
});


test('hosted checkout freezes server pricing, returns a redirect and reuses its session', async t => {
 const {createCheckout}=require('../dist/modules/payments/payments.controller');
 const config=require('../dist/config/stripe');const {env}=require('../dist/config/env');
 const classId='11111111-1111-4111-8111-111111111111';let row;let creates=0;let retrieves=0;
 const origin=env.FRONTEND_URLS.split(',')[0].trim();
 mock(t,config,'getStripe',()=>({checkout:{sessions:{create:async(input,options)=>{creates++;assert.equal(input.mode,'payment');assert.equal(input.line_items[0].price_data.unit_amount,1250);assert.equal(input.payment_intent_data.metadata.userId,user.id);assert.equal(options.idempotencyKey,'hosted-checkout:payment');assert.ok(input.success_url.endsWith('session_id={CHECKOUT_SESSION_ID}'));return {id:'cs_review',status:'open',url:'https://checkout.stripe.com/review'};},retrieve:async id=>{retrieves++;assert.equal(id,'cs_review');return {id,status:'open',url:'https://checkout.stripe.com/review'};}}}}));
 mock(t,prisma,'$transaction',async fn=>fn(prisma));mock(t,prisma,'$queryRaw',async()=>[]);
 mock(t,prisma.masterclass,'findUnique',async()=>({isPublished:true,status:'active',priceCents:1250,title:'Class'}));mock(t,prisma.enrollment,'findUnique',async()=>null);
 mock(t,prisma.payment,'findFirst',async()=>row);mock(t,prisma.payment,'create',async({data})=>row={...data,id:'payment',checkoutSessionId:null});mock(t,prisma.payment,'updateMany',async({data})=>{Object.assign(row,data);return {count:1};});
 const req={user,body:{masterclassId:classId,successUrl:origin+'/checkout?success=true',cancelUrl:origin+'/checkout'}};const res=response();await createCheckout(req,res);
 assert.equal(res.body.data.checkoutUrl,'https://checkout.stripe.com/review');assert.equal(res.body.data.amountCents,1250);assert.equal(row.checkoutSessionId,'cs_review');
 await createCheckout(req,response());assert.equal(creates,1);assert.equal(retrieves,1);
 await assert.rejects(createCheckout({...req,body:{...req.body,successUrl:'https://attacker.example/checkout'}},response()),e=>e.status===400);
});

test('hosted checkout expiration releases only a pending reservation and deduplicates delivery',async t=>{
 const {processPaymentEvent}=require('../dist/modules/payments/payments.controller');let recorded=false;let updates=0;
 mock(t,prisma,'$transaction',async fn=>fn(prisma));mock(t,prisma.paymentWebhookEvent,'findUnique',async()=>recorded?{id:'evt_expired'}:null);
 mock(t,prisma.paymentWebhookEvent,'create',async()=>{recorded=true;});mock(t,prisma.payment,'findUnique',async()=>({id:'payment',checkoutSessionId:'cs_review'}));
 mock(t,prisma.payment,'updateMany',async({where,data})=>{updates++;assert.equal(where.status,'pending');assert.equal(data.status,'failed');return {count:1};});
 const event={id:'evt_expired',type:'checkout.session.expired',data:{object:{id:'cs_review',metadata:{paymentId:'payment'}}}};await processPaymentEvent(event);await processPaymentEvent(event);assert.equal(updates,1);
});

test('owner course detail includes drafts and serializes recording metadata without BigInt',async t=>{
 const controller=require('../dist/modules/masterclasses/admin.masterclasses.controller');let query;
 mock(t,prisma.masterclass,'findUnique',async input=>{query=input;return {id:'draft',isPublished:false,sessions:[{id:'lesson',recording:{id:'media',filename:'lesson.mp4',transcode:{status:'queued'}}}],_count:{sessions:1,enrollments:2}};});
 const res=response();await controller.getMasterclass({params:{id:'draft'}},res);assert.deepEqual(query.where,{id:'draft'});assert.equal(res.body.data.enrollmentsCount,2);assert.equal(res.body.data.sessions[0].recording.transcode.status,'queued');assert.doesNotThrow(()=>JSON.stringify(res.body));
});
