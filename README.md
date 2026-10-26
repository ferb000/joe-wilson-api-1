# Mr. Wilson Platform — Backend API

This is the backend for the Mr. Wilson music artist and masterclass platform. I built this as a REST API that serves three different surfaces — the public website, the member portal where students access their courses, and the admin dashboard where Joseph manages everything.

It took a while to figure out the right structure for this but I eventually settled on a module-based approach where each feature lives in its own folder with its own routes, controller, and logic. Makes it a lot easier to find things and add new features without breaking what already works.


## What's Inside

The platform has three types of users and the backend handles all of them differently:

- **Public visitors** can browse services, events, testimonials, and submit contact or booking requests — no login needed
- **Members** can access masterclasses they've paid for, watch video lessons, track their progress, and download resources
- **The owner (Joseph)** has a full admin panel to manage everything — students, payments, content, media, inquiries, and site settings


## Tech Choices and Why

I went back and forth on a few of these so worth explaining my thinking:

**Node.js + TypeScript** — TypeScript saved me several times during development. The type checking catches mistakes before they become runtime errors which on a payment platform is exactly what you want.

**Express.js** — Considered NestJS but it felt like too much structure for the size of this project. Express gives you full control and the ecosystem is massive when you need to look something up.

**PostgreSQL + Prisma** — The data here is highly relational. Enrollments need payments, payments need users, sessions need masterclasses. A relational database enforces all of that at the database level rather than in application code. Prisma handles migrations cleanly and the type-safe queries are a big productivity boost.

**JWT with refresh token rotation** ? Access tokens expire after 15 minutes and refresh JWTs after 30 days by default. Refresh tokens are stored as full SHA-256 hashes and rotate atomically. Logout and password reset revoke access tokens through a database token version. One refresh session per user is supported.

**Cloudflare R2 / AWS S3** — Files can't live on the server itself. R2 was the recommendation here because there are no egress fees which matters when students are downloading PDFs and audio files repeatedly.

**Redis** ? Required for distributed request limits and BullMQ email delivery. Configure a Redis instance supporting the blocking operations used by BullMQ.



## Project Layout

mr-wilson-api/
├── src/
│   ├── config/          # Database, Redis, S3 connections + env validation
│   ├── middleware/       # Auth guards, admin guard, enrollment check, error handler
│   ├── modules/         # One folder per feature
│   │   ├── auth/
│   │   ├── masterclasses/
│   │   ├── sessions/
│   │   ├── enrollments/
│   │   ├── payments/
│   │   ├── media/
│   │   ├── inquiries/
│   │   ├── quotes/
│   │   ├── services/
│   │   ├── events/
│   │   ├── testimonials/
│   │   ├── settings/
│   │   ├── users/
│   │   └── dashboard/
│   ├── utils/           # JWT, email, pagination, response helpers, signed URLs
│   └── app.ts           # Entry point
├── prisma/
│   ├── schema.prisma    # All 14 tables
│   └── seed.ts          # Sample data
├── .env.example
├── docker-compose.yml
└── package.json


## Getting Started

### Requirements
- Node.js 20+
- Docker Desktop (for local PostgreSQL and Redis) OR free accounts on Neon and Upstash

### 1. Install dependencies

```bash
npm install
```


### 2. Set up environment variables

```bash

copy .env.example .env
```

Open `.env` and fill in the required values. At minimum you need:

```env
DATABASE_URL=        # PostgreSQL connection string
JWT_SECRET=          # Random 64-char string (see below)
JWT_REFRESH_SECRET=  # Different random 64-char string
REDIS_URL=           # redis:// or rediss:// connection
FRONTEND_URLS=       # Comma-separated frontend origins
```

To generate the JWT secrets run this and use the output (run it twice for two different values):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Start the database

**With Docker:**
```bash
docker-compose up -d
```

**Without Docker (recommended for Windows):**
- PostgreSQL → create a free database at neon.tech, copy the connection string
- Redis → create a free database at upstash.com, copy the Redis URL

Paste both into your `.env` file.

### 4. Run migrations

```bash
npm run db:migrate
```

Existing migrations are committed. For production, use `npm run db:deploy`.

### 5. Seed sample data

```bash
npm run db:seed
```

Demo seeding is disabled in production. Set `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, and `SEED_MEMBER_PASSWORD` to your own values before running it. Passwords must be strong and at least 12 characters. No fixed password is provided.

For a production owner, set `OWNER_EMAIL` and `OWNER_PASSWORD` and run `npm run owner:create` from an environment with development tools installed. This creates a new account and refuses to overwrite an existing one.

### 6. Start the server

```bash
npm run dev
```

Server runs at `http://localhost:3001`

Quick check — open this in your browser:
```
http://localhost:3001/health
```

Should return `{ "status": "ok" }`. If it does everything is working.

---

## API Overview

Base URL: `http://localhost:3001/v1`

Every response follows the same format:
```json
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "limit": 20, "total": 50 }
}
```

### Auth
```
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/forgot-password
POST   /v1/auth/reset-password
GET    /v1/auth/me
PATCH  /v1/auth/me
```

### Public (no login required)
```
GET    /v1/services
GET    /v1/services/:slug
GET    /v1/events
GET    /v1/testimonials
GET    /v1/settings/public
POST   /v1/inquiries
POST   /v1/quotes
```

### Member (login required)
```
GET    /v1/masterclasses
GET    /v1/masterclasses/:id
GET    /v1/sessions/:id
POST   /v1/sessions/:id/progress
GET    /v1/enrollments/my
POST   /v1/payments/checkout
GET    /v1/payments/my
```

### Admin (owner only)
```
GET    /v1/admin/dashboard
GET    /v1/admin/masterclasses
POST   /v1/admin/masterclasses
PATCH  /v1/admin/masterclasses/:id
POST   /v1/admin/masterclasses/:id/sessions
GET    /v1/admin/users
GET    /v1/admin/payments
GET    /v1/admin/payments/export/csv
POST   /v1/admin/payments/:id/refund
GET    /v1/admin/media
POST   /v1/admin/media/upload
GET    /v1/inquiries
POST   /v1/inquiries/:id/reply
GET    /v1/admin/quotes
PATCH  /v1/admin/quotes/:id/status
```

---

## Things Still Needed

A few integrations are built and ready but need credentials before they go live:

**Payments (Stripe)**

Configure both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Without both, payment endpoints return HTTP 503. Checkout creates an idempotent hosted Stripe Checkout session using the server price in USD and reserves capacity. Redirect the browser to the returned checkoutUrl. Optional successUrl and cancelUrl must use an origin in FRONTEND_URLS; payment success is established only by a signed webhook. Signed webhooks grant enrollment once; full confirmed refunds revoke it. Partial refunds do not revoke access. Failed card attempts retain a reservation so customers can retry. Cancel abandoned pending checkout with `DELETE /v1/payments/checkout/:id` to release capacity. Subscribe to `payment_intent.succeeded`, `payment_intent.canceled`, `checkout.session.expired`, and `charge.refunded`. Expired hosted sessions release pending reservations. Verify the complete flow in Stripe test mode before enabling live payments.

**Recorded media playback (S3 or R2)**

1. Configure S3_BUCKET and S3_REGION with the AWS bucket region. For R2, use region auto and S3_ENDPOINT. Supply AWS credentials or an IAM role with GetObject/PutObject/DeleteObject permissions. Keep the bucket private.
2. Run npm run db:deploy and npm run db:generate. Existing provider identifiers are retained in the database for reference; export and upload existing recordings separately.
3. Small uploads use `POST /v1/admin/media/upload` (multipart `file`, 50 MB limit). Large files use the multipart workflow below. Existing private bucket objects can be registered with `POST /v1/admin/media/import` and `{ "storageKey": "media/lesson.mp4" }`. Admin responses include storageKey, url, and sizeBytes as a decimal string.
4. Create/update a session with `videoMediaId` from the media library, or videoStorageKey (e.g. media/<id>/lesson.mp4), using an object key rather than a URL. Only private audio/video library records can be attached. Set null to detach it.
5. Run the separate worker with `npm run video:worker:start`. New video uploads queue automatically. `GET /v1/sessions/:id` returns an enrollment-protected HLS playback URL only after encoding finishes; queued/processing/failed videos return a null playback URL and processingStatus. Use an HLS-capable player and refresh the authenticated endpoint when the grant expires.

The custom FFmpeg worker generates H.264/AAC adaptive HLS, stores it privately in S3, and supports up to 360p/720p/1080p without upscaling. Set API_PUBLIC_URL to your actual API base URL. See [video transcoding setup](docs/VIDEO_TRANSCODING.md) for worker deployment, access checks, frontend playback, and costs. Live broadcasting remains separate.

Configure bucket CORS with your actual frontend origins:

```json
[{"AllowedOrigins":["http://localhost:3000","https://your-frontend.example"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["Range"],"ExposeHeaders":["Accept-Ranges","Content-Range","Content-Length","ETag"],"MaxAgeSeconds":3600}]
```

See [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) and [S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html).

**Email (Resend)**

Configure `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL`. Run `npm run worker:start` as a separate production process (or `npm run worker` during development). Notifications enter a database outbox; the worker dispatches them to BullMQ and retries failed deliveries. Password reset returns 503 when email is unavailable. Other notifications are disabled when no email key is set. Retain pending outbox rows, monitor failed jobs, and periodically prune old dispatched outbox rows according to your retention policy.

---

## Deployment

The easiest path to production is Railway:

1. Push to GitHub
2. Create a new project on Railway and connect the repo
3. Add PostgreSQL and Redis from the Railway plugin marketplace
4. Copy all environment variables into Railway's environment settings
5. Run `npm run db:deploy` to apply migrations on the production database
6. Railway handles SSL and deploys automatically on every push

---

## Available Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Compile TypeScript to JavaScript
npm run start        # Run compiled production build
npm run db:migrate   # Create and apply a new migration
npm run db:deploy    # Apply pending migrations (use this in production)
npm run db:seed      # Seed the database with sample data
npm run db:studio    # Open Prisma Studio — visual database browser
npm run db:generate  # Regenerate Prisma client after schema changes
```

---


## Review fixes and operational changes

See [README_REVIEW.md](README_REVIEW.md) for findings 1-13, repairs, tests, and remaining integration checks.

- Run `npm ci`, `npm run db:generate`, and `npm test` to verify changes. CI also validates Prisma and audits production dependencies.
- Apply the committed migrations with `npm run db:deploy` before deploying this version. Old tokens are invalidated by the new authentication contract; users must log in again. Existing seeded passwords must be rotated through password reset.
- Railway applies ordinary migrations before starting `dist/server.js`. Docker starts the server directly; run a migration job first, or invoke `./start.sh` to migrate and start.
- `/health` is liveness; `/ready` checks PostgreSQL and Redis.
- Production API documentation is disabled unless `DOCS_TOKEN` is configured. Browser login uses username `docs` and the token as password; requests may also use `Authorization: Bearer <token>`.
- List APIs return bounded pages: `page=1&limit=20` by default, maximum limit 100, and pagination metadata. Clients must load additional pages.
- Public images require `S3_PUBLIC_BASE_URL` serving only the `public/` prefix through a CDN or appropriately scoped storage policy. Set `isPublic=true` for image uploads and use their stable URL in cover/avatar fields. Keep lesson recordings private.
- Video grants last up to one hour, but every playlist/segment request rechecks enrollment and revocation. Already-issued S3 segment links last at most 60 seconds; resource download links last at most 15 minutes, capped by enrollment expiry. Do not log or share these bearer URLs.

### Direct multipart uploads

1. `POST /v1/admin/media/uploads` with filename, mimeType, numeric sizeBytes, and optional isPublic. The API returns an upload id, 10 MB partSize, and partsCount. Default maximum file size is 5 GiB; S3_MAX_UPLOAD_BYTES can lower it.
2. For each part, `POST /v1/admin/media/uploads/:id/parts` with `{ "partNumber": 1 }`. PUT the corresponding file slice to the returned URL. All parts must be exactly partSize except the final part.
3. `POST /v1/admin/media/uploads/:id/complete`. The API verifies storage part sizes, completes the object, checks its metadata, and registers the media record. Retry after transient failures; an interrupted finalization reservation can be retried after five minutes.
4. `DELETE /v1/admin/media/uploads/:id` aborts unfinished/expired uploads. Configure bucket lifecycle rules to abort incomplete multipart uploads after one day. Failed database registration remains recoverable by completion; monitor orphan-cleanup logs.

Bucket CORS for multipart uploads also needs PUT and exposed ETag. Replace origins with your actual frontend:

```json
[{"AllowedOrigins":["http://localhost:3000","https://your-frontend.example"],"AllowedMethods":["GET","HEAD","PUT"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag","Accept-Ranges","Content-Range","Content-Length"],"MaxAgeSeconds":3600}]
```

### Resources

Owners can list/create resources at `/v1/admin/resources` and update/delete at `/v1/admin/resources/:id`. Each resource has mediaId, label, orderIndex and exactly one parent: sessionId or masterclassId. Supply the parent id as a query parameter when listing. Detach resources and recordings before deleting their media.
