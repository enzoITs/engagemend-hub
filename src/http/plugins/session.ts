import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { getSessionUser } from '../../store/auth.js';
export const SESSION_COOKIE = 'engagemend_session';
declare module 'fastify' { interface FastifyRequest { user: { id: string; email: string }; } }
const sessionHook: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    /* O shell do painel precisa carregar antes do login; somente as rotas de
       dados exigem sessão. Os HTML são estáticos e não expõem informação da
       conta. */
    if (request.url.startsWith('/api/auth/') || request.url === '/' || request.url.endsWith('.html')) return;
    const sessionId = request.cookies[SESSION_COOKIE];
    if (!sessionId) return reply.code(401).send({ error: 'não autenticado' });
    const user = await getSessionUser(sessionId);
    if (!user) return reply.code(401).send({ error: 'sessão inválida ou expirada' });
    request.user = user;
  });
};
export const sessionPlugin = fp(sessionHook);
