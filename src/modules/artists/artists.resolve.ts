import { Router } from 'express';
import { prisma } from '../../config/database';
import { notFound } from '../../utils/response';
import { handle } from './artists.http';
import { id, routeIdentifier } from './artists.schema';
import { publicProjectWhere } from './artists.service';

/** Resolve public slugs to UUIDs once, so existing scoped CRUD/read handlers are reused. */
export function resolvePublicIdentifiers(router: Router) {
  router.param('artistId', (req, res, next, value: string) => {
    handle(async () => {
      routeIdentifier.parse(value);
      const artist = await prisma.artist.findFirst({
        where: { ...(id.safeParse(value).success ? { id: value } : { slug: value }), isPublished: true },
        select: { id: true },
      });
      if (!artist) return notFound(res, 'Artist not found or unavailable');
      req.params.artistId = artist.id;
      return next();
    })(req, res, next);
  });
  for (const param of ['projectId', 'id']) {
    router.param(param, (req, res, next, value: string) => {
      // Generic :id also serves taxonomy and child resources; those remain UUID-only.
      if (param === 'id' && (!req.params.artistId || req.params.projectId)) return next();
      handle(async () => {
        routeIdentifier.parse(value);
        const project = await prisma.artistProject.findFirst({
          where: { ...(id.safeParse(value).success ? { id: value } : { slug: value }), artistId: req.params.artistId, ...publicProjectWhere },
          select: { id: true },
        });
        if (!project) return notFound(res, 'Project not found or unavailable for this artist');
        req.params[param] = project.id;
        return next();
      })(req, res, next);
    });
  }
}
