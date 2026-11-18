# Artist portfolio API

All changes are local source changes. No production migration, seed, push or deployment has been performed.

## Installation and migrations

Run `npm ci`, `npm run db:generate`, then `npm run db:deploy` **against the intended database when deployment is approved**. The migration adds only the artist portfolio tables; it does not alter existing content tables.

Optional: `npm run db:seed:artists` imports the existing 37 artists and six project examples as drafts, preserving existing records. Review video versions and credits before publishing. It is not run automatically.

## Routes

Public base: `/v1/artists`. Admin base: `/v1/admin/artists`.

| Resource suffix | Public | Admin |
| --- | --- | --- |
| `/filters` | GET all region/country/genre options | GET |
| `/regions`, `/countries`, `/genres` | GET paginated list; GET `/:id` | GET, POST; GET, PATCH, DELETE `/:id` |
| `/` | GET paginated artists | GET, POST |
| `/:artistId` | GET published artist with projects | GET, PATCH, DELETE |
| `/:artistId/projects` | GET paginated published projects | GET, POST |
| `/:artistId/projects/:id` | GET project | GET, PATCH, DELETE |
| `/:artistId/projects/:projectId/videos` | GET paginated published videos | GET, POST |
| `/:artistId/projects/:projectId/videos/:id` | GET video | GET, PATCH, DELETE |
| `/:artistId/projects/:projectId/credits` | GET paginated credits | GET, POST |
| `/:artistId/projects/:projectId/credits/:id` | GET credit | GET, PATCH, DELETE |
| `/:artistId/projects/:projectId/videos/:videoId/thumbnails` | GET paginated thumbnails | GET, POST |
| `/:artistId/projects/:projectId/videos/:videoId/thumbnails/:id` | GET thumbnail | GET, PATCH, DELETE |

All admin routes require a valid existing owner account's Bearer access token. The database role is rechecked on every request, so deleted/demoted owners cannot continue using old tokens. Public endpoints never accept writes.

## Inputs

- Region/genre: `name`, `slug`, optional `orderIndex`.
- Country: `name`, uppercase two-letter `code`, `regionId`, optional `orderIndex`. Artist region is derived from its country.
- Artist: `name`, `slug`, `countryId`, `genreId`, optional `biography`, `orderIndex`, `isPublished`.
- Project: `title`, optional `slug`, `description`, `orderIndex`, `isPublished`.
- Video: `youtubeUrl` or `youtubeId`, optional `title`, nullable `customCoverUrl`, `orderIndex`, `isPublished`. If both URL and ID are supplied they must match. Supported URLs: youtube.com/watch, youtu.be, Shorts, live and embed, with recognized mobile/music/no-cookie hosts. IDs are validated and canonicalized; arbitrary domains and embedded credentials are rejected. URL parsing does not verify video availability or embedding permissions and does not fetch external resources.
- Credit: `role`, optional `name` (defaults to Joe Wilson), `orderIndex`.
- Thumbnail: HTTPS `url`, `altText`, optional `orderIndex`.

PATCH accepts a nonempty subset of fields. Unknown keys are rejected. Parent IDs cannot be reassigned in child PATCH bodies. Stored IDs and admin route identifiers are UUIDs; public artist/project paths also accept slugs. Text lengths, sort positions, URLs, and pagination are bounded.

Video cover priority: `customCoverUrl` > first ordered thumbnail record > generated YouTube thumbnail. Set `customCoverUrl: null` to remove the override. Video responses include canonical `youtubeUrl`, `embedUrl`, `generatedThumbnailUrl`, and resolved `thumbnailUrl`.

## Public compatibility and visibility

Artist objects expose string `region`, `country`, and `genre` fields plus their IDs. Project objects expose `title`, `role` (ordered Joe Wilson credits), `youtubeId`, `thumbnailUrl`, `videos`, and `credits`. The first ordered published video supplies the card image and play action.

Artists, projects and videos default to drafts. An artist must be published to appear publicly. A project appears only when it and at least one video are published. Draft parents hide all children on every public endpoint. Admin reads include drafts. Unpublishing/removing the last published video removes its project from public results.

Artists support combined `region`, `country`, `genre`, `regionId`, `countryId`, `genreId`, and `q` filters. Region/genre accept names or slugs; country accepts name or code. `All regions`, `All countries`, `All` omit the corresponding filter. `Other countries` excludes GH/NG to match the current frontend. Admin artist/project/video lists also accept `isPublished=true|false`.

All list endpoints support `page` (1–1000000) and `limit` (1–100). Responses use `{ success: true, data, meta: { page, limit, total, totalPages } }`. Sorting is stable by `orderIndex`, then ID. Artist list responses include all eligible projects to support the project dialog; admin lists omit projects and detail includes them.

Errors: 400 invalid input; 401 invalid/missing token; 403 non-owner; 404 missing/wrong-parent/hidden draft; 409 duplicate unique values or invalid/in-use relationships. Deletes return 204. Artist deletion cascades to projects, videos, thumbnails and credits; referenced taxonomy deletion is restricted. Image files remain externally hosted; deleting a URL record does not delete storage assets.

## Tests

Use a disposable PostgreSQL database whose name starts with `joe_artists_test`:

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/joe_artists_test npm run test:artists
```

The suite applies migrations only to this explicit test URL and runs real HTTP requests against PostgreSQL, covering all CRUD routes, authentication, publishing, hierarchy scoping, filtering/pagination, URL validation, custom cover fallback, and cascades. It creates and cleans only its own fixtures.

## Artists → Projects → Project Details (slug routing)

Existing public routes accept **UUIDs or lowercase slugs** without a duplicate set of endpoints:

```text
GET /v1/artists/mogmusic
GET /v1/artists/mogmusic/projects?page=1&limit=20
GET /v1/artists/mogmusic/projects/holy-chant
GET /v1/artists/mogmusic/projects/holy-chant/related?page=1&limit=3
```

An artist slug resolves only to a published artist; project slugs resolve only inside that artist. Mixed slug/UUID paths and nested video/credit/thumbnail reads are supported. All returned records retain UUID `id`/foreign-key fields. Admin routes continue using UUIDs so the existing panel remains compatible.

Projects now expose a nonempty `slug`, unique within each artist. Admin POST/PATCH project inputs accept an optional slug. If omitted on create, a slug is generated from the title plus the new UUID, preserving duplicate titles without collisions. Renaming a title does not change its URL. Explicit slug conflicts return 409. UUID-shaped content slugs and artist slugs reserved by `/filters`, `/regions`, `/countries`, `/genres` are rejected on new writes.

Migration `20261117160000_add_artist_project_slugs` backfills existing projects using title-plus-UUID slugs, then enforces NOT NULL and a per-artist unique index. Existing UUIDs, descriptions, credits and publishing states are unchanged. Apply only when deployment is authorized. No live database migration has been performed.

Project detail GET retains its previous fields and adds:

- `artist`: profile with name, slug, biography, region, country and genre.
- `youtubeUrl` and `embedUrl`: the selected published video's canonical URLs, alongside the existing `youtubeId` and `thumbnailUrl`.
- `relatedProjects`: up to three ordered projects from the same artist, excluding the current project.
- `links`: canonical API URLs for `self`, `artist`, `projects` and paginated `related` navigation.

The new related suffix is also available under the authenticated admin base using UUIDs. Public related results exclude draft projects and projects without a published video. Unpublished source projects/artists return the same 404 response as missing records. Empty results return 200 with `data: []` and pagination metadata, never 404. Project lists and related lists accept `q` (title/description search), `credit` (credit role search), `page` and `limit`; admin lists additionally accept `isPublished`.

### Integration states and errors

| Client state | API behavior |
| --- | --- |
| Loading | Client tracks the pending HTTP request; the API does not return a premature success or fabricated loading record. |
| Success | 200 `{ success: true, data }`; collections include `meta`. Creates return 201; deletes return 204. |
| Empty collection | 200 `{ success: true, data: [], meta }`, including zero totals. |
| Invalid input | 400 `{ success: false, error, details }` with bounded inputs and Zod issue paths. |
| Missing/unpublished/wrong artist | 404 `{ success: false, error }`, with no draft content exposed. |
| Authentication/authorization | 401/403 using the existing Bearer and database owner checks. |
| Duplicate slug/in-use relationship | 409 `{ success: false, error }`. |
| Transient database failure | 503 `{ success: false, error }`, `Retry-After: 5`; clients can offer retry. |
| Unexpected failure | 500 `{ success: false, error }`; internal details are logged, not returned. |

Existing frontend/admin requests and UUID navigation remain valid. Frontend/admin source files were not changed. API response additions are optional for existing consumers; new consumers can use slug URLs and server-provided related results directly. Full project collections remain included in artist detail for the current frontend, while the nested project list supports pagination for other integrations.

## File pickers and uploaded project videos

The admin Media Library endpoints (`/v1/admin/media`, `/upload`, `/:id`) now return usable public `url` fields, numeric `sizeBytes`, correct media types, and no storage keys. Uploads use authenticated multipart `file` inputs: images up to 10 MB, videos up to 50 MB, JPEG/PNG/WebP/GIF or MP4/WebM/MOV with header validation. Invalid content returns 400, oversized files 413, unconfigured storage 503 and referenced-file deletion 409. Current owner roles are rechecked in the database. File names never determine storage paths.

Production continues to use configured S3 storage. Development may set `MEDIA_LOCAL_DIR` to a persistent directory and `MEDIA_PUBLIC_BASE_URL` to the local API origin. Local files are served under `/v1/uploads` with safe generated extensions, no directory indexes/dotfiles, range requests, and cross-origin resource headers for public previews. Local disk storage is rejected in production. The local test launcher configures these values automatically and does not use live storage credentials.

Project video inputs accept either the existing YouTube URL/ID or `{ source: "upload", mediaId: "<video-library-UUID>" }`. IDs must identify an uploaded video, not an image/document. Switching sources clears incompatible identifiers; database constraints enforce one valid source. Responses expose `source`, nullable `youtubeId`/`youtubeUrl`/`embedUrl`, `videoUrl` for uploaded files and a safe `media` summary. Custom covers and thumbnail records override generated YouTube thumbnails. Public project detail also exposes its selected `source` and `videoUrl`; uploaded sources have no YouTube URL. Video files cannot be removed while referenced.

Masterclass cover creation/editing uses the same library. Admin detail GET is available at `/v1/admin/masterclasses/:id` (including drafts), and list responses include cover URLs/descriptions. Free masterclasses are accepted at zero price, and request validation uses the existing body-wrapper contract. Clearing an avatar accepts null.

Validation: `TEST_DATABASE_URL=<disposable-joe_artists_test-URL> npm run test:media` exercises authenticated image/video uploads, MIME/size rejection, image fetching, library filters, uploaded and YouTube source switching, reference protection, and masterclass cover save/read/delete behavior. No cloud storage is used by these tests.
