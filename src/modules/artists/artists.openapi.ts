// Kept alongside the module so new portfolio endpoints appear in /docs.
type Schema = Record<string, unknown>;
const uuid = { type: 'string', format: 'uuid' };
const text = { type: 'string', maxLength: 160, minLength: 1 };
const orderIndex = { type: 'integer', minimum: 0, maximum: 1000000, default: 0 };
const published = { type: 'boolean', default: false };
const description = { type: 'string', maxLength: 10000, nullable: true };
const slug = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 160 };
const https = { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 };
function object(properties: Schema, required: string[] = []) { return { type: 'object', additionalProperties: false, properties, required }; }
export const artistSchemas: Record<string, Schema> = {
  PortfolioRegionInput: object({ name: text, slug, orderIndex }, ['name', 'slug']),
  PortfolioGenreInput: object({ name: text, slug, orderIndex }, ['name', 'slug']),
  PortfolioCountryInput: object({ name: text, code: { type: 'string', pattern: '^[A-Z]{2}$' }, regionId: uuid, orderIndex }, ['name', 'code', 'regionId']),
  PortfolioArtistInput: object({ name: text, slug, biography: description, countryId: uuid, genreId: uuid, orderIndex, isPublished: published }, ['name', 'slug', 'countryId', 'genreId']),
  PortfolioProjectInput: object({ title: text, slug: { ...slug, description: 'Optional; generated from title and UUID when omitted, unique per artist' }, description, orderIndex, isPublished: published }, ['title']),
  PortfolioVideoInput: { ...object({ title: { ...text, nullable: true }, source: { type: 'string', enum: ['youtube','upload'] }, mediaId: uuid, youtubeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' }, youtubeUrl: { type: 'string', maxLength: 2048, description: 'Recognized YouTube watch, shortened, Shorts, live or embed URL.' }, customCoverUrl: { ...https, nullable: true }, orderIndex, isPublished: published }), anyOf: [{ required: ['youtubeId'] }, { required: ['youtubeUrl'] }, { required: ['mediaId'] }] },
  PortfolioCreditInput: object({ name: { ...text, default: 'Joe Wilson' }, role: text, orderIndex }, ['role']),
  PortfolioThumbnailInput: object({ url: https, altText: text, orderIndex }, ['url', 'altText']),
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const meta = ref('PaginationMeta');
const paginated = { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object' } }, meta } };
const single = { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } };
const response = (description: string, schema: Schema = single) => ({ description, content: { 'application/json': { schema } } });
const pagination = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
const resources = [
  ['', '/{artistId}', 'PortfolioArtistInput'],
  ['/regions', '/regions/{id}', 'PortfolioRegionInput'],
  ['/countries', '/countries/{id}', 'PortfolioCountryInput'],
  ['/genres', '/genres/{id}', 'PortfolioGenreInput'],
  ['/{artistId}/projects', '/{artistId}/projects/{id}', 'PortfolioProjectInput'],
  ['/{artistId}/projects/{projectId}/videos', '/{artistId}/projects/{projectId}/videos/{id}', 'PortfolioVideoInput'],
  ['/{artistId}/projects/{projectId}/credits', '/{artistId}/projects/{projectId}/credits/{id}', 'PortfolioCreditInput'],
  ['/{artistId}/projects/{projectId}/videos/{videoId}/thumbnails', '/{artistId}/projects/{projectId}/videos/{videoId}/thumbnails/{id}', 'PortfolioThumbnailInput'],
];
function pathParams(path: string, admin = false) {
  return [...path.matchAll(/\{(\w+)\}/g)].map(match => ({
    name: match[1], in: 'path', required: true,
    schema: !admin && (match[1] === 'artistId' || match[1] === 'projectId' || (match[1] === 'id' && path.endsWith('/projects/{id}'))) ? { type: 'string', description: 'UUID or lowercase slug' } : uuid,
  }));
}
export const artistPaths: Record<string, unknown> = {};
for (const admin of [false, true]) {
  const base = admin ? '/admin/artists' : '/artists';
  const common = { tags: ['Artist portfolio'], ...(admin && { security: [{ bearerAuth: [] }] }) };
  artistPaths[`${base}/filters`] = { get: { ...common, summary: 'Region, country and genre options', responses: { 200: response('Filter options') } } };
  const relatedPath = '/{artistId}/projects/{projectId}/related';
  artistPaths[base + relatedPath] = { get: {
    ...common, summary: 'Related projects from the same artist, excluding the current project',
    parameters: [...pathParams(relatedPath, admin), ...pagination, { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'credit', in: 'query', schema: { type: 'string' } }, ...(admin ? [{ name: 'isPublished', in: 'query', schema: { type: 'boolean' } }] : [])],
    responses: { 200: response('Paginated related projects (empty data array when none)', paginated), 400: response('Invalid query or identifier'), 404: response('Artist or source project missing or unpublished') },
  } };
  for (const [collection, item, input] of resources) {
    const query: Record<string, unknown>[] = [...pagination];
    if (!collection) {
      for (const name of ['region', 'country', 'genre', 'regionId', 'countryId', 'genreId', 'q']) query.push({ name, in: 'query', schema: { type: 'string' } });
    }
    if (input === 'PortfolioProjectInput') {
      for (const name of ['q', 'credit']) query.push({ name, in: 'query', schema: { type: 'string' } });
    }
    if (admin && (!collection || ['PortfolioProjectInput', 'PortfolioVideoInput'].includes(input))) query.push({ name: 'isPublished', in: 'query', schema: { type: 'boolean' } });
    const collectionOps: Record<string, unknown> = {
      get: { ...common, summary: `List ${input.replace('Portfolio', '').replace('Input', '').toLowerCase()} records`, parameters: [...pathParams(collection, admin), ...query], responses: { 200: response('Paginated records', paginated), 400: response('Invalid query') } },
    };
    const itemOps: Record<string, unknown> = {
      get: { ...common, summary: 'Get record', parameters: pathParams(item, admin), responses: { 200: response('Record'), 404: response('Missing or unpublished record') } },
    };
    if (admin) {
      collectionOps.post = { ...common, summary: 'Create record (owner)', parameters: pathParams(collection, admin), requestBody: { required: true, content: { 'application/json': { schema: ref(input) } } }, responses: { 201: response('Created'), 400: response('Invalid input'), 401: response('Unauthorized'), 403: response('Owner access required'), 409: response('Conflict') } };
      const patch = { ...(artistSchemas[input] as Schema), required: [], anyOf: undefined, minProperties: 1 };
      itemOps.patch = { ...common, summary: 'Update record, including publishing (owner)', parameters: pathParams(item, admin), requestBody: { required: true, content: { 'application/json': { schema: patch } } }, responses: { 200: response('Updated'), 400: response('Invalid input'), 404: response('Not found'), 409: response('Conflict') } };
      itemOps.delete = { ...common, summary: 'Delete record (owner)', parameters: pathParams(item, admin), responses: { 204: { description: 'Deleted' }, 404: response('Not found'), 409: response('Record still in use') } };
    }
    artistPaths[base + collection] = collectionOps;
    artistPaths[base + item] = itemOps;
  }
}
