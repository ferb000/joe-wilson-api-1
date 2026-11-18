import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';
import { ok, created, noContent, notFound, forbidden } from '../../utils/response';
import { getPaginationMeta, getSkip } from '../../utils/pagination';
import * as schema from './artists.schema';
import { resolvePublicIdentifiers } from './artists.resolve';
import { handle, validateParams, invalidParent } from './artists.http';
import {
  ordered, publicArtistInclude, adminArtistInclude, publicProjectInclude,
  adminProjectInclude, publicProjectWhere, artistDTO, projectDTO, artistWhere,
  artistExists, projectExists, videoExists, videoDTO, normalizeVideo,
  createProjectData, projectWhere, projectDetails, relatedProjectList,
} from './artists.service';

type Page = z.infer<typeof schema.adminProjectQuery>;
type Params = Record<string, string>;
interface Resource<T> {
  query?: { parse: (input: unknown) => Page };
  parent?: (params: Params) => Promise<unknown>;
  list: (params: Params, query: Page) => Promise<[unknown[], number]>;
  get: (params: Params) => Promise<unknown>;
  create: (params: Params, data: T) => Promise<unknown>;
  update: (params: Params, data: Partial<T>) => Promise<unknown>;
  delete: (params: Params) => Promise<unknown>;
}

// Shared, validated CRUD for project videos, thumbnails, credits and vocabularies.
// Each adapter scopes its database operations to its parent, including updates/deletes.
function registerResource<S extends z.AnyZodObject>(
  router: Router, path: string, input: S, resource: Resource<z.infer<S>>, admin: boolean,
) {
  async function validate(req: Request) {
    validateParams(req.params);
    return !resource.parent || !!(await resource.parent(req.params));
  }
  router.get(path, handle(async (req, res) => {
    if (!await validate(req)) return invalidParent(res);
    const query = (resource.query ?? schema.pageQuery).parse(req.query);
    const [rows, total] = await resource.list(req.params, query);
    return ok(res, rows, getPaginationMeta(total, query));
  }));
  router.get(`${path}/:id`, handle(async (req, res) => {
    if (!await validate(req)) return invalidParent(res);
    const row = await resource.get(req.params);
    return row ? ok(res, row) : notFound(res);
  }));
  if (!admin) return;
  router.post(path, handle(async (req, res) => {
    if (!await validate(req)) return invalidParent(res);
    return created(res, await resource.create(req.params, input.parse(req.body)));
  }));
  router.patch(`${path}/:id`, handle(async (req, res) => {
    if (!await validate(req)) return invalidParent(res);
    const data = schema.patchSchema(input).parse(req.body) as Partial<z.infer<S>>;
    return ok(res, await resource.update(req.params, data));
  }));
  router.delete(`${path}/:id`, handle(async (req, res) => {
    if (!await validate(req)) return invalidParent(res);
    await resource.delete(req.params);
    return noContent(res);
  }));
}

export function createArtistsRouter(admin = false) {
  const router = Router();
  if (!admin) resolvePublicIdentifiers(router);
  if (admin) {
    router.use(authenticate, requireAdmin);
    // Recheck the database role so a deleted/demoted owner's old JWT is rejected.
    router.use(handle(async (req: AuthRequest, res, next) => {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { role: true } });
      if (!user || user.role !== 'owner') return forbidden(res, 'Admin access required');
      return next();
    }));
  }

  router.get('/filters', handle(async (req, res) => {
    z.object({}).strict().parse(req.query);
    const [regions, countries, genres] = await prisma.$transaction([
      prisma.artistRegion.findMany({ orderBy: ordered }),
      prisma.artistCountry.findMany({ orderBy: ordered, include: { region: true } }),
      prisma.artistGenre.findMany({ orderBy: ordered }),
    ]);
    return ok(res, { regions, countries, genres });
  }));

  registerResource(router, '/regions', schema.regionInput, {
    list: async (_p, q) => prisma.$transaction([
      prisma.artistRegion.findMany({ orderBy: ordered, skip: getSkip(q), take: q.limit }), prisma.artistRegion.count(),
    ]),
    get: p => prisma.artistRegion.findUnique({ where: { id: p.id } }),
    create: (_p, data) => prisma.artistRegion.create({ data }),
    update: (p, data) => prisma.artistRegion.update({ where: { id: p.id }, data }),
    delete: p => prisma.artistRegion.delete({ where: { id: p.id } }),
  }, admin);
  registerResource(router, '/countries', schema.countryInput, {
    list: async (_p, q) => prisma.$transaction([
      prisma.artistCountry.findMany({ orderBy: ordered, skip: getSkip(q), take: q.limit, include: { region: true } }), prisma.artistCountry.count(),
    ]),
    get: p => prisma.artistCountry.findUnique({ where: { id: p.id }, include: { region: true } }),
    create: (_p, data) => prisma.artistCountry.create({ data }),
    update: (p, data) => prisma.artistCountry.update({ where: { id: p.id }, data }),
    delete: p => prisma.artistCountry.delete({ where: { id: p.id } }),
  }, admin);
  registerResource(router, '/genres', schema.genreInput, {
    list: async (_p, q) => prisma.$transaction([
      prisma.artistGenre.findMany({ orderBy: ordered, skip: getSkip(q), take: q.limit }), prisma.artistGenre.count(),
    ]),
    get: p => prisma.artistGenre.findUnique({ where: { id: p.id } }),
    create: (_p, data) => prisma.artistGenre.create({ data }),
    update: (p, data) => prisma.artistGenre.update({ where: { id: p.id }, data }),
    delete: p => prisma.artistGenre.delete({ where: { id: p.id } }),
  }, admin);

  router.get('/', handle(async (req, res) => {
    const query = (admin ? schema.adminArtistQuery : schema.artistQuery).parse(req.query);
    const where = artistWhere(query, admin);
    const [artists, total] = await prisma.$transaction([
      prisma.artist.findMany({ where, orderBy: ordered, skip: getSkip(query), take: query.limit,
        include: admin ? adminArtistInclude : publicArtistInclude }),
      prisma.artist.count({ where }),
    ]);
    return ok(res, artists.map(artistDTO), getPaginationMeta(total, query));
  }));
  router.get('/:artistId', handle(async (req, res) => {
    validateParams(req.params);
    const artist = await prisma.artist.findFirst({
      where: { id: req.params.artistId, ...(!admin && { isPublished: true }) },
      include: admin ? { ...adminArtistInclude, projects: { orderBy: ordered, include: adminProjectInclude } } : publicArtistInclude,
    });
    return artist ? ok(res, artistDTO(artist)) : notFound(res);
  }));
  if (admin) {
    router.post('/', handle(async (req, res) => {
      const data = schema.artistInput.parse(req.body);
      return created(res, artistDTO(await prisma.artist.create({ data, include: adminArtistInclude })));
    }));
    router.patch('/:artistId', handle(async (req, res) => {
      validateParams(req.params);
      const data = schema.patchSchema(schema.artistInput).parse(req.body);
      return ok(res, artistDTO(await prisma.artist.update({ where: { id: req.params.artistId }, data, include: adminArtistInclude })));
    }));
    router.delete('/:artistId', handle(async (req, res) => {
      validateParams(req.params);
      await prisma.artist.delete({ where: { id: req.params.artistId } });
      return noContent(res);
    }));
  }

  router.get('/:artistId/projects/:projectId/related', handle(async (req, res) => {
    validateParams(req.params);
    const query = (admin ? schema.adminProjectQuery : schema.projectQuery).parse(req.query);
    if (!await projectExists(req.params.artistId, req.params.projectId, admin)) return invalidParent(res);
    const related = await relatedProjectList(req.params.artistId, req.params.projectId, query, admin);
    return ok(res, related.projects, getPaginationMeta(related.total, query));
  }));

  registerResource(router, '/:artistId/projects', schema.projectInput, {
    query: admin ? schema.adminProjectQuery : schema.projectQuery,
    parent: p => artistExists(p.artistId, admin),
    list: async (p, q) => {
      const where = projectWhere(p.artistId, q, admin);
      const [rows, total] = await prisma.$transaction([
        prisma.artistProject.findMany({ where, orderBy: ordered, skip: getSkip(q), take: q.limit, include: admin ? adminProjectInclude : publicProjectInclude }),
        prisma.artistProject.count({ where }),
      ]);
      return [rows.map(projectDTO), total];
    },
    get: p => projectDetails(p.artistId, p.id, admin),
    create: async (p, data) => projectDTO(await prisma.artistProject.create({ data: createProjectData(data, p.artistId), include: adminProjectInclude })),
    update: async (p, data) => projectDTO(await prisma.artistProject.update({ where: { id: p.id, artistId: p.artistId }, data, include: adminProjectInclude })),
    delete: p => prisma.artistProject.delete({ where: { id: p.id, artistId: p.artistId } }),
  }, admin);

  registerResource(router, '/:artistId/projects/:projectId/videos', schema.videoInput, {
    query: admin ? schema.adminChildQuery : schema.pageQuery,
    parent: p => projectExists(p.artistId, p.projectId, admin),
    list: async (p, q) => {
      const where = { projectId: p.projectId, ...(!admin ? { isPublished: true } : q.isPublished !== undefined ? { isPublished: q.isPublished } : {}) };
      const [rows, total] = await prisma.$transaction([
        prisma.artistVideo.findMany({ where, orderBy: ordered, skip: getSkip(q), take: q.limit, include: { thumbnails: { orderBy: ordered }, media: true } }),
        prisma.artistVideo.count({ where }),
      ]);
      return [rows.map(videoDTO), total];
    },
    get: async p => {
      const row = await prisma.artistVideo.findFirst({ where: { id: p.id, projectId: p.projectId, ...(!admin && { isPublished: true }) }, include: { thumbnails: { orderBy: ordered }, media: true } });
      return row && videoDTO(row);
    },
    create: async (p, data) => {
      const normalized = await normalizeVideo(data, true);
      return videoDTO(await prisma.artistVideo.create({ data: { ...normalized, projectId: p.projectId }, include: { thumbnails: { orderBy: ordered }, media: true } }));
    },
    update: async (p, data) => {
      const current = await prisma.artistVideo.findFirstOrThrow({ where: { id: p.id, projectId: p.projectId } });
      const normalized = await normalizeVideo(data, false, current);
      return videoDTO(await prisma.artistVideo.update({ where: { id: p.id, projectId: p.projectId }, data: normalized, include: { thumbnails: { orderBy: ordered }, media: true } }));
    },
    delete: p => prisma.artistVideo.delete({ where: { id: p.id, projectId: p.projectId } }),
  }, admin);

  registerResource(router, '/:artistId/projects/:projectId/credits', schema.creditInput, {
    parent: p => projectExists(p.artistId, p.projectId, admin),
    list: async (p, q) => prisma.$transaction([
      prisma.artistCredit.findMany({ where: { projectId: p.projectId }, orderBy: ordered, skip: getSkip(q), take: q.limit }),
      prisma.artistCredit.count({ where: { projectId: p.projectId } }),
    ]),
    get: p => prisma.artistCredit.findFirst({ where: { id: p.id, projectId: p.projectId } }),
    create: (p, data) => prisma.artistCredit.create({ data: { ...data, projectId: p.projectId } }),
    update: (p, data) => prisma.artistCredit.update({ where: { id: p.id, projectId: p.projectId }, data }),
    delete: p => prisma.artistCredit.delete({ where: { id: p.id, projectId: p.projectId } }),
  }, admin);

  registerResource(router, '/:artistId/projects/:projectId/videos/:videoId/thumbnails', schema.thumbnailInput, {
    parent: p => videoExists(p.artistId, p.projectId, p.videoId, admin),
    list: async (p, q) => prisma.$transaction([
      prisma.artistThumbnail.findMany({ where: { videoId: p.videoId }, orderBy: ordered, skip: getSkip(q), take: q.limit }),
      prisma.artistThumbnail.count({ where: { videoId: p.videoId } }),
    ]),
    get: p => prisma.artistThumbnail.findFirst({ where: { id: p.id, videoId: p.videoId } }),
    create: (p, data) => prisma.artistThumbnail.create({ data: { ...data, videoId: p.videoId } }),
    update: (p, data) => prisma.artistThumbnail.update({ where: { id: p.id, videoId: p.videoId }, data }),
    delete: p => prisma.artistThumbnail.delete({ where: { id: p.id, videoId: p.videoId } }),
  }, admin);
  return router;
}

export const publicArtistsRouter = createArtistsRouter();
export const adminArtistsRouter = createArtistsRouter(true);
