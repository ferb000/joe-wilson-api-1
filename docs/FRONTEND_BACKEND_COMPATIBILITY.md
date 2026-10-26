# Repair status ? 2026-10-26

The local repairs below are implemented in the requested order. The original review follows as a historical record; its blocked/missing findings describe the pre-repair source. The JSON contract report now records the repaired source.

| Order | Module | Completed changes |
| --- | --- | --- |
| 1 | Admin roles and routes | owner authorization in frontend; correct dashboard/users/payment paths; protected course detail includes drafts; separate unfiltered owner service/event listings |
| 2 | Checkout | Hosted Stripe Checkout response matches browser redirect; allowlisted return origins; frozen server pricing and idempotency; expired-session reservation release; webhook-confirmed enrollment |
| 3 | HLS and resources | Mux removed; native HLS/hls.js playback; grant renewal and position/progress handling; processing/error states; course/session resource attachment and member downloads |
| 4 | Content forms and mappings | Explicit writable projections; nullable optional images; local-date conversion; event description/location migration; corrected service detail, quote statuses, enrollment counts/progress and resource mapping; shared canonical types and field errors |
| 5 | Pagination and settings | Page controls for owner lists, media and testimonials; complete public/selector lists; backend course search; booking email/location/Instagram made public; multipart uploads and transcode retry UI |

Verification: backend build and 56 tests pass, including real FFmpeg output; frontend client/admin TypeScript checks and production builds pass; frontend tests cover pagination, form projections, and native HLS renewal/progress; adapter contract script checks 77 calls and nine schema payloads with no missing routes. External providers and a migrated running database have not been exercised.

Before deployment, apply the new hosted-checkout and event-details migrations (and all earlier pending migrations), regenerate Prisma, configure frontend origins/API URLs, and run the transcode worker. Stripe needs checkout.session.expired in addition to payment_intent.succeeded, payment_intent.canceled and charge.refunded. S3 needs browser PUT/GET/HEAD CORS on the frontend origins. Keep private source and transcoded objects private. Validate Stripe test-mode checkout and browser playback against staging.

Dependency cleanup removed unused Mux, embedded Stripe, Firebase, Supabase and chart SDKs. Compatible audit fixes removed all critical/high findings; three moderate Tailwind/PostCSS development-tool advisories remain because npm's suggested fix upgrades Tailwind to a breaking major version.

---

# Frontend/backend compatibility review

Review date: 2026-10-26.

**Verdict: the current local backend does not fit the current frontend exactly.** Admin entry, checkout, recorded-video playback, service details/quotes, and several content-editing flows have concrete incompatibilities. The common `/v1` base and JSON envelope are mostly aligned, but matching a URL does not establish matching authorization, payloads, or responses.

Frontend reviewed: `C:\Users\LATITUDE\Documents\joe-wilson\joe-wilson-portfolio-main\joe-wilson-portfolio-main`, including `apps/client`, `apps/admin`, and `shared`. Backend reviewed: this repository's current working tree, including the recent security, payment, S3, and custom-transcoding changes. These local changes are not assumed to be deployed to Railway.

`F:` references below are relative to the frontend root. `B:` references are relative to this backend root. No application behavior was changed in this review.

## Evidence and limits

- Built the backend successfully.
- Executed the actual frontend API adapters with a local transport double: captured **63 calls**, including repeated/helper calls, and compared their method/path pairs to backend route declarations. **Six calls use missing method/path combinations.** This is not a count of 63 distinct endpoints or proof that the other calls work end to end.
- Reproduced **seven request-schema mismatches** using the backend's actual Zod schemas.
- Reproduced the service-details/quote response mismatch, discarded validation-field errors, discarded course resources, and session numbering drift with the actual frontend helper/mapper code.
- Confirmed quote status options `accepted` and `declined` are not accepted by the backend.
- Reproduction script: [review-frontend-contracts.cjs](../scripts/review-frontend-contracts.cjs). Results: [frontend-contract-checks.json](frontend-contract-checks.json).
- No live API, customer account, database, payment, bucket, or email service was used. Frontend dependencies are absent in this checkout, so a frontend build/type-check and browser tests were **not** run. TypeScript generic response annotations do not validate backend JSON at runtime.

Reproduce from the backend root:

```sh
npm run build
node scripts/review-frontend-contracts.cjs "C:/Users/LATITUDE/Documents/joe-wilson/joe-wilson-portfolio-main/joe-wilson-portfolio-main"
```

## Compatibility matrix

| Flow | Assessment | Main reason |
| --- | --- | --- |
| Member signup/login/current user/profile | Mostly aligned | Paths, token envelope, and main fields agree; validation-error details and maximum password length differ |
| Refresh/logout/password reset | Main contract aligned | Frontend stores returned rotated tokens; real deployment/email verification remains necessary |
| Public masterclass catalog | Mostly aligned | Actual client types use `priceCents`/`coverImageUrl`; pagination is dropped |
| Member course details/enrollments | Partial | Summary fields, access state, progress, and resource mappings are incomplete |
| Checkout | Blocked | Hosted Checkout frontend versus PaymentIntent backend; extra request keys are rejected |
| Recorded video | Blocked | Mux/iframe frontend versus custom HLS backend |
| Resource downloads | Not wired | Backend returns resources, but frontend mapper empties them and buttons lack actions |
| Admin login/access | Blocked | `admin` versus `owner` |
| Admin dashboard/users/media | Blocked | Missing `/admin` in six adapter calls |
| Admin course/session management | Blocked/partial | Draft read path, Mux fields, empty schedule, missing media assignment/editing |
| Public services and quote form | Blocked | Nested service response treated as a flat service |
| Admin services/testimonials/events | Blocked/partial | Strict payload mismatch, blank/null URLs, full records sent on update, public-only list APIs |
| Contact inquiry submission | Main contract aligned | Adapter converts public form names and inquiry type to backend names |
| Public contact/social settings | Partial | Three UI setting keys are excluded from the public whitelist |
| Public music/gallery | Unimplemented feature | Placeholder frontend screens and no corresponding public catalog APIs |

## Findings, ordered by impact

### 1. P1: backend owners cannot enter the admin dashboard

The backend role enum/guard uses `member` and `owner`. The frontend shared user type, login page, and route guard expect `member` and `admin` and explicitly reject `owner`.

A successful backend owner login therefore produces “This account does not have administrator access.” Changing only the TypeScript type will not fix the two runtime checks.

Evidence: F `shared/types/auth.types.ts`, `apps/admin/src/pages/LoginPage.tsx:25`, `apps/admin/src/components/auth/ProtectedAdminRoute.tsx:12`; B `prisma/schema.prisma`, `src/middleware/requireAdmin.ts:6`.

**Alignment:** use one role contract across both applications. Keeping `owner` in the frontend is the smallest change for the current backend. Preserve server authorization; do not make the route guard accept arbitrary roles.

### 2. P1: checkout has incompatible input and output

The checkout page posts `{ masterclassId, successUrl, cancelUrl }`. The backend's strict schema accepts only `{ masterclassId }`, so the current page's request is rejected with HTTP 400 when the gateway is configured. When it is disabled, the backend returns 503.

There is a second independent mismatch: the frontend redirects to `checkoutUrl`, while the backend returns `{ paymentId, clientSecret, amountCents, currency }` for a PaymentIntent. Removing the extra input fields would still leave checkout unusable.

Evidence: F `apps/client/src/pages/checkout/page.tsx:35`, `apps/client/src/hooks/payments/usePayments.ts:18`, `apps/client/src/types/payment.types.ts`; B `src/modules/payments/payments.controller.ts:13` and `:39`.

**Alignment:** choose one payment UX. To preserve the existing redirect UX, implement Stripe Checkout Sessions with approved return URLs and compatible signed webhook processing. To preserve the current backend, replace the redirect code with Stripe Elements/payment confirmation using `clientSecret`. The success query parameter is a presentation signal, not payment/enrollment proof.

### 3. P1: the frontend cannot play the custom HLS recordings

The lesson page uses `LessonPlayer` only when `muxPlaybackId` exists. That component imports the Mux player and requires a Mux playback ID. Otherwise, the page loads `playbackUrl` into an iframe after the user clicks play.

The backend now returns a protected HLS `.m3u8` URL. A playlist URL is not an HTML video embed. The current branch does not implement HLS playback, rendition selection, media progress/resume, or grant refresh. Its processing screen also cannot distinguish queued, processing, failed, and genuinely absent videos.

Evidence: F `apps/client/src/components/feature/LessonPlayer.tsx:2`, `apps/client/src/pages/members/VideoLessonPage.tsx:135`, `apps/client/src/hooks/sessions/useSession.ts`; B `src/modules/media/transcoding/playback.ts:47`, `src/modules/sessions/sessions.controller.ts`.

**Alignment:** replace the Mux/iframe recording branch with an HLS-capable player using `playbackUrl`, `playbackType`, `processingStatus`, and `playbackUrlExpiresAt`. Wire time/pause/end events to progress updates, restore position after refreshed grants, and display processing/failure states. Keep external live embeds as a separate case.

### 4. P1: six admin calls target nonexistent routes

| Frontend call | Backend route |
| --- | --- |
| `GET /v1/dashboard` | `GET /v1/admin/dashboard` |
| `GET /v1/media` | `GET /v1/admin/media` |
| `POST /v1/media/upload` | `POST /v1/admin/media/upload` |
| `DELETE /v1/media/:id` | `DELETE /v1/admin/media/:id` |
| `GET /v1/users` | `GET /v1/admin/users` |
| `GET /v1/users/:id` | `GET /v1/admin/users/:id` |

Evidence: F `apps/admin/src/api/admin.api.ts:26`, `:41`, `:42`, `:43`, `:49`, `:50`; B `src/app.ts:70` through `:74`. The route inventory reproduced all six mismatches.

**Alignment:** correct the admin adapter paths. Do not change the shared base URL to `/v1/admin`: that would break calls already containing `/admin` and shared auth/public-content paths.

### 5. P1: admin course details use a published-member endpoint

The admin editor requests `/masterclasses/:id`. That backend endpoint requires `isPublished: true`; a newly created draft returns 404. It also serializes sessions for members and omits admin recording identifiers, so even published courses cannot supply the full admin editor contract.

There is currently no `GET /v1/admin/masterclasses/:id` handler to switch to. The admin page's `if (query.isPending || !draft)` runs before error rendering, so a failed fetch can appear as an endless loading screen.

Evidence: F `apps/admin/src/api/admin.api.ts:28`, `apps/admin/src/pages/MasterclassDetailPage.tsx:13`; B `src/modules/masterclasses/masterclasses.controller.ts`, `src/modules/masterclasses/admin.masterclasses.routes.ts`.

**Alignment:** add an owner-protected admin detail endpoint returning draft/published data and admin session/media identifiers, point the editor to it, and render fetch errors before the missing-draft loading fallback. Preserve member/public filtering.

### 6. P1: the admin session form cannot create a current session

Its default object always includes `scheduledAt: ""` and `muxPlaybackId: ""`. The backend rejects the empty datetime and rejects Mux keys under its strict schema. The form has no current `videoMediaId` selection, no processing-status/retry controls, and no resource assignment flow. Existing UI only adds/deletes sessions; its update API function is not connected to a session editor.

Evidence: F `apps/admin/src/pages/MasterclassDetailPage.tsx:8`, `apps/admin/src/api/admin.api.ts:10`; B `src/modules/masterclasses/admin.masterclasses.controller.ts:26`, `src/modules/media/media.routes.ts`.

**Alignment:** omit unset schedule values, remove Mux fields, add library-video selection and session editing/status controls, and use the transcode status/retry APIs. Sending a source URL or Mux ID will not attach a library recording.

### 7. P1: the service detail response breaks service pages and all quote submissions

The backend returns `data: { service, relatedServices }`. `servicesApi.getBySlug()` unwraps only the outer API envelope and tells TypeScript the result is a flat `Service`. The detail page then reads missing `.title`, `.coverImageUrl`, `.description`, and `.slug` fields.

The quote adapter calls that same function and checks `service.id`. It is undefined for this response, so the quote request is rejected locally as unavailable before `POST /quotes` is called—even when the backend returned the service successfully.

Evidence: F `apps/client/src/api/services.api.ts:10`, `apps/client/src/api/quotes.api.ts:9`, `apps/client/src/pages/services/ServiceDetailPage.tsx`; B `src/modules/services/services.controller.ts:16`. Reproduced with the real adapters and a backend-shaped response.

**Alignment:** define a service-detail DTO and explicitly return its `.service` to flat consumers, or update consumers to the nested response. Preserve/consume related services deliberately.

### 8. P1: event and content forms conflict with strict backend schemas

Reproduced cases:

- Events always send `description` and `location`, which the backend event schema/database contract does not expose. It uses `venue`, `city`, `country`, and `ticketUrl` instead. The event form's ISO conversion itself is compatible.
- New testimonials send `avatarUrl: ""`, rejected by the optional URL schema. “Optional” permits omission, not an empty string.
- New services send `coverImageUrl: ""`, also rejected.
- Editing existing testimonials/services forwards the fetched record, including `id` and potentially `createdAt`. Strict update schemas reject these server-owned fields.
- Nullable backend URL/text fields need deliberate normalization when submitted through schemas accepting optional strings; merely stripping `id` is not enough for every record.

Evidence: F `apps/admin/src/pages/EventsPage.tsx:7`, `apps/admin/src/pages/ServicesPage.tsx:7` and `:10`, `apps/admin/src/pages/SettingsPage.tsx:7` and `:20`; B corresponding `events.schema.ts`, `services.schema.ts`, and `testimonials.schema.ts`.

**Alignment:** explicitly project writable request fields and normalize blanks/nulls. Decide whether to map event location to venue/city or add intentional description/location fields to the backend/schema. Do not disable strict schemas or forward arbitrary database records.

### 9. P1: resources exist in the backend but not in the usable UI

The backend returns course/session resources with protected media URLs. `mapMasterclassToCohort()` always sets `resourceList: []`, discarding them. The course page's download and “View All Session Resources” buttons have no URL/action. The admin adapter/UI has no calls to `/v1/admin/resources` to attach or manage resources.

Evidence: F `apps/client/src/lib/mappers/masterclass.mapper.ts:61`, `apps/client/src/pages/members/MasterclassDetailPage.tsx`, `apps/admin/src/api/admin.api.ts`; B `src/modules/resources/resources.routes.ts`, `src/utils/mediaResponse.ts`. Mapper data loss was reproduced.

**Alignment:** add resource DTOs and mapping, actual download/play actions, expired-link refresh, and admin resource management. Video resources require the HLS player, not a generic file download.

### 10. P2: list consumers silently discard pagination

Backend list endpoints default to 20 rows and return pagination metadata. Both frontend list helpers return only `data`; adapters generally expose neither page/limit inputs nor metadata. Admin users/payments explicitly request 100 rows, but still cannot load beyond that page. Media search is performed only over the already-fetched page.

Consequences include missing courses at checkout, incomplete admin lists, and searches that suggest existing records do not exist. The existing array envelope is compatible; the missing pagination behavior is the issue.

Evidence: F `shared/lib/api-response.ts:13`, `apps/client/src/lib/api-response.ts`, list adapters, `apps/admin/src/pages/MediaLibraryPage.tsx:15`; B `src/utils/pagination.ts` and list controllers.

**Alignment:** return `{ items, meta }` or an equivalent stable page DTO, pass page/filter inputs, and provide pagination/load-more/search against the backend.

### 11. P2: admin service/event lists cannot manage drafts or past events

The admin app uses public `/services` and `/events` lists. Those backend controllers always filter to published services and published future events, even for an owner. Newly created default-unpublished content disappears from the admin list; unpublishing removes the record needed to publish it again. Past events cannot be managed through the current list.

**Alignment:** provide owner-protected unfiltered management lists and use them in admin. Keep the public filters intact.

### 12. P2: three public settings keys never reach their consumers

Admin saves `booking_email`, `contact_location`, and `social_instagram`. The public frontend reads them, but the backend public-settings whitelist excludes all three. Settings save can succeed while the home/about location, booking email, or Instagram link remains missing.

Evidence: F `apps/admin/src/pages/SettingsPage.tsx:8`, `apps/client/src/components/feature/Footer.tsx:22`, `apps/client/src/pages/home/components/ContactPreviewSection.tsx:55`, `apps/client/src/pages/about/components/AboutContact.tsx`; B `src/modules/settings/settings.controller.ts:6`.

**Alignment:** agree on public key names and include these intentionally public values, or migrate frontend usage to the existing canonical keys. Do not expose all settings.

### 13. P2: media upload UI predates the storage/transcoding contract

Besides the wrong URLs in finding 4, the UI only uses a single buffered upload request and a shared 30-second Axios timeout. The backend supports small uploads up to 50 MB and direct multipart uploads for larger recordings. The UI has no multipart flow or encoding status polling.

Uploads do not pass `isPublic`; images therefore get expiring private URLs. Copying such an image URL into persistent cover/avatar fields leads to broken images later. The stable public-image flow requires `isPublic=true` and configured public-image delivery.

`sizeBytes` is typed as a number in admin but returned as a decimal string. The current formatter coerces numeric strings and does not necessarily crash; this is type drift, not the primary upload failure.

Evidence: F `apps/admin/src/api/admin.api.ts:9` and `:42`, `apps/admin/src/pages/MediaLibraryPage.tsx`, `shared/api/client.ts`; B `src/modules/media/media.controller.ts`, `src/modules/media/media.service.ts`.

**Alignment:** fix URLs, add multipart recording uploads and status/retry UI, distinguish public images from protected files, and update size types.

### 14. P2: progress, counts, and access summaries have incomplete mappings

- The session hook already normalizes `lastWatchedSeconds` into `watchedSeconds`, which is good. It does not derive `completed` from backend `completedAt`.
- Course detail returns `isEnrolled` plus per-session progress, while the frontend detail hook looks for `enrollment`; existing per-user course progress is not passed through consistently.
- `/enrollments/my` returns nested masterclass summaries and `hasAccess`. The real hook correctly uses nested masterclass data and `progressPct`; missing top-level IDs in its declared type are not currently the main runtime failure. However, it ignores `hasAccess`/expiry, so expired enrollments can still look active until the backend denies playback.
- Enrollment summaries omit fields the UI's full `Masterclass` type assumes, including description/end date.
- Backend admin course lists return `enrolledCount`; the frontend expects `enrollmentsCount`. Dashboard active courses similarly return `_count` plus `enrolledCount`, while the UI reads `enrollmentsCount` and `sessionsCount`, leading to zero/default counts.
- Admin starts `orderIndex` at 1; the member mapper adds 1, so the first such session displays as Session 2. Reproduced with the actual mapper.

**Alignment:** distinguish summary/detail DTOs, map completion and entitlement state explicitly, normalize aggregate names, and choose one ordering convention.

### 15. P2: quote status changes and validation errors drift

The admin select offers `accepted` and `declined`. Backend quote statuses are `new`, `reviewing`, `quoted`, `booked`, `closed`; choosing those two options returns 400. Conversely the UI lacks controls for `booked` and `closed`.

Backend validation uses `details.fieldErrors`; the shared error parser reads `errors` or an array under `error`. Field-level feedback is lost and users generally receive “Validation failed.” Some controller-specific validation also returns a serialized error string rather than that shared format.

Evidence: F `apps/admin/src/pages/QuoteRequestsPage.tsx:5`, `shared/lib/errors.ts:88`; B `src/modules/quotes/quotes.routes.ts`, `src/middleware/validate.ts:5`. Both status and field-error mismatches were reproduced.

**Alignment:** share canonical quote statuses and a single field-error envelope; normalize errors once in the shared frontend client.

### 16. P2: shared types are not a canonical API contract

The frontend has duplicated shared/client types. The actual local client course/content types already match many backend names, but shared masterclass/content/payment types still contain older uppercase statuses and renamed fields. Shared auth still names `admin`, local session types still name Mux fields, and payment types still name `checkoutUrl`.

In particular, the uppercase payment-status declaration is stale, but current account display does not branch on it and the admin payment page correctly checks `succeeded`; this should not be reported as a failure of every payment-history render.

**Alignment:** consolidate real request/response DTOs, ideally generated from an accurate OpenAPI contract with contract tests. A frontend build alone cannot discover mismatches hidden behind `axios.get<ExpectedType>()`.

### 17. Configuration and feature-completeness limits

- Both Vite configurations default to the Railway host, not this local backend. Set `VITE_API_BASE_URL=http://localhost:3001` in each app for local comparisons. Use the host without `/v1`; adapters append it. Production needs both frontend origins in backend `FRONTEND_URLS` and the API's actual HTTPS base in `API_PUBLIC_URL` for HLS.
- The source contains local backend changes/migrations; frontend handoff docs describing the live API and Mux are stale for this architecture. Deployment version/migration parity has not been established.
- Free classes can be created with zero price, but paid checkout requires at least 50 USD cents. Define free enrollment behavior or prevent unsupported prices in the publishing UI.
- Signup/reset checks align on minimum length and uppercase/lowercase/number rules, but the backend's 72 UTF-8 byte maximum is not reflected in the UI.
- Music and gallery pages are placeholders, not broken calls to already-existing APIs. Neither a public music/releases catalog nor public gallery management is implemented in this backend.
- The backend intentionally supports one active refresh session per user. If the same owner will sign into separate client/admin origins simultaneously, verify that the desired cross-portal session policy matches that limitation.

## What currently aligns

The `/v1` base convention, bearer Authorization header, `{ success, data }` envelope, registration/profile field names, refresh token request/response, public contact inquiry adapter, lowercase runtime course/session statuses, `priceCents` display, amount-in-cents payment history, testimonial display mapper, and basic published-content list routes are largely compatible. Existing adapters already translate inquiry fields and progress writes (`watchedSeconds` → `lastWatchedSeconds`). Preserve those working mappings.

## Recommended repair sequence

1. Agree on the canonical role, payment UX, video DTO, and summary/detail response shapes. Keep enrollment and strict-write protections.
2. Fix admin role checks and the six paths; add the missing admin course-detail and draft-content list APIs.
3. Align checkout end to end, including provider confirmation, webhook enrollment, and success/error states.
4. Replace Mux/iframe video playback and connect resources, video assignment, upload processing, and grant refresh.
5. Normalize content form payloads, quote service-detail unwrapping/statuses, settings keys, progress/counts, and pagination.
6. Consolidate types/error contracts, update deployment docs/env, then run both frontend builds/type-checks and staging browser tests.

Acceptance should include owner login, draft course creation/reopen/edit, unpublished service/event management, quote submission/status changes, an actual test-mode purchase through enrollment, HLS playback/seek/resume/expiry/refund denial, large video upload/transcode status, protected resource downloads, stable public images, and lists spanning multiple pages.
