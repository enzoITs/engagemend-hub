import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import { sessionPlugin } from './plugins/session.js';
export function buildServer(): FastifyInstance {
  const app = Fastify({ loggerInstance: logger as never });
  app.register(cookie);
  app.register(sessionPlugin);
  return app as unknown as FastifyInstance;
}
