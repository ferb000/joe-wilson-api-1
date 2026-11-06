# Free Render API deployment

This blueprint deploys the API as a free Render Node web service. It expects PostgreSQL and Redis URLs from external free-tier providers. It does not deploy the separate frontend repository.

## 1. Create the external services

- Create a PostgreSQL database with Neon (or another hosted PostgreSQL provider) and copy its direct (non-pooled) connection string into `DATABASE_URL`. Prisma migrations use PostgreSQL advisory locks, which are not supported by transaction poolers.
- Create a Redis database with Upstash and copy its TLS connection string (`rediss://...`) into `REDIS_URL`.

These services have their own free-tier limits and policies. Keep the database and Redis in a nearby region to Render when possible.

## 2. Deploy the API

1. Push this repository to GitHub.
2. In the separate frontend repository, create two Render **Static Sites** so you know their public origins. Use the repository root as `Root Directory` for both:
   - Public client: build command `npm ci && npm run build:client`, publish directory `apps/client/out`.
   - Admin: build command `npm ci && npm run build:admin`, publish directory `apps/admin/out`.
   Set `VITE_API_BASE_URL` to a temporary placeholder during this first deploy. Add a rewrite rule `/*` → `/index.html` (Rewrite) to each site so direct React Router links work.
3. In Render, choose **New → Blueprint**, connect the API repository, and select `render.yaml`.
4. When prompted, enter `DATABASE_URL`, `REDIS_URL`, `FRONTEND_URLS`, and `CORS_ORIGINS`.
   - `FRONTEND_URLS` is the exact origins of both deployed sites, with no trailing slash, comma-separated (for example, `https://your-site.onrender.com,https://your-admin.onrender.com`).
   - `CORS_ORIGINS` is the browser CORS allowlist; use those same deployed origins. Do not add localhost when the developer uses the Vite proxy to reach this API.
5. Render builds the TypeScript app and runs `prisma migrate deploy` before starting the API. Do not run development migrations against this hosted database.
6. Check `https://<api-host>/ready`. A ready response means both PostgreSQL and Redis are reachable.
7. Add `API_PUBLIC_URL` in the service's Environment settings using the API's HTTPS `onrender.com` URL, then save to redeploy. Playback and upload links use this public base URL.

The blueprint generates separate JWT secrets. Keep them in Render's environment settings and never commit them.

## 3. Point the frontend at the API

Set `VITE_API_BASE_URL` to `https://<api-host>` (without `/v1`) in the environment settings for both static sites, then rebuild them. Confirm both site origins are in `FRONTEND_URLS` and `CORS_ORIGINS` and redeploy the API if you changed them after blueprint creation.

For a developer running the Vite UI locally against this hosted API, set `VITE_API_BASE_URL=https://<api-host>` in both apps' ignored `.env.local` files and restart Vite. The development client calls `/v1` through the Vite proxy, so ordinary API requests stay same-origin in the browser and do not require `http://localhost:3000` or `http://localhost:5174` in `CORS_ORIGINS`. `FRONTEND_URLS` is also used to validate payment return URLs; include localhost there only if the developer needs to test Stripe Checkout returns.

HLS playback links point directly to `API_PUBLIC_URL`; a browser fetching them needs the local UI origin allowed by `CORS_ORIGINS` (and the frontend origin allowed in the S3 bucket's browser CORS settings). Add localhost to `CORS_ORIGINS` temporarily if local video playback against hosted media is part of the test.

## Running the FFmpeg worker

For the fully local setup, `npm run dev:local` starts the API, both UIs, and the video worker automatically when `STORAGE_DRIVER=local`. To run only the worker in a separate terminal, run `npm run local:video` from the API repository root. FFmpeg and ffprobe must be installed and configured with `FFMPEG_PATH` and `FFPROBE_PATH` in `.env.local`; local video files stay under `.local-storage`.

To process videos for the hosted API, run the worker as a separate long-running process on a host with FFmpeg/ffprobe including the `libx264` encoder. Build the API repo, provide the same hosted `DATABASE_URL` and S3 environment variables as the API (`S3_BUCKET`, `S3_REGION`, and credentials or role; also `S3_ENDPOINT` for compatible storage), set `NODE_ENV=production` and `STORAGE_DRIVER=s3`, then start `npm run video:worker:start`. The worker claims queued jobs from PostgreSQL and reads/writes private objects in S3; it does not need Redis. Render does not offer a free background-worker service, so this process must run on a separate machine/provider for hosted video transcoding.

## Free test deployment limitations

- Render's free API service sleeps after 15 minutes without traffic and may take about a minute to wake. Its filesystem is ephemeral.
- Render free PostgreSQL databases expire after 30 days, so use Neon for a longer-lived test database.
- Free Render Key Value is in-memory and can lose data on restarts; use the external Redis URL above.
- Without S3-compatible storage configured, API and UI flows that upload files or play media will fail with a storage-not-configured response. Do not point `STORAGE_DRIVER` at local storage on Render. Add an S3-compatible bucket (for example AWS S3 or Cloudflare R2) and set `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` when applicable, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` to test uploads and video.
- The custom FFmpeg transcoding worker is not part of this free API blueprint. Existing transcoded media in S3 can play through the API, but new videos will not be transcoded unless you run the worker on a separate host.
- Stripe checkout requires test credentials and a webhook secret; email password-reset delivery requires `RESEND_API_KEY`. Leave them unset if the frontend test does not cover those features.
- This setup is for frontend integration testing, not production availability. Free services may sleep, restart, or have limited quotas.
