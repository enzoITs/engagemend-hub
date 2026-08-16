import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import { sessionPlugin } from './plugins/session.js';
import { registerAuthRoutes } from './auth.js';
import { registerConexoesRoutes } from './conexoes.js';
import { registerComunidadesRoutes } from './comunidades.js';
import { registerNotificacoesRoutes } from './notificacoes.js';
import { registerBuscaRoutes } from './busca.js';
import { registerConfiguracoesRoutes } from './configuracoes.js';
export function buildServer(): FastifyInstance {
  const app = Fastify({ loggerInstance: logger as never });
  app.register(cookie);
  app.register(multipart);
  app.register(registerAuthRoutes);
  app.register(sessionPlugin);
  app.register(registerConexoesRoutes);
  app.register(registerComunidadesRoutes);
  app.register(registerNotificacoesRoutes);
  app.register(registerBuscaRoutes);
  app.register(registerConfiguracoesRoutes);
  return app as unknown as FastifyInstance;
}
