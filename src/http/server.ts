import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import { sessionPlugin } from './plugins/session.js';
import { registerAuthRoutes } from './auth.js';
import { registerConexoesRoutes } from './conexoes.js';
export function buildServer(): FastifyInstance {
  const app = Fastify({ loggerInstance: logger as never });
  app.register(cookie);
  app.register(registerAuthRoutes);
  app.register(sessionPlugin);
  app.register(registerConexoesRoutes);
  return app as unknown as FastifyInstance;
}
