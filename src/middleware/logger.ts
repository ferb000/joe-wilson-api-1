import pinoHttp from 'pino-http';
import { logger } from '../config/logger';
export const httpLogger = pinoHttp({ logger, serializers: { req(req) { return { id: req.id, method: req.method, url: (req.url || '').split('?')[0], headers: { authorization: req.headers?.authorization, cookie: req.headers?.cookie } }; } } });
