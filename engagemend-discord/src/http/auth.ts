import type { FastifyInstance } from 'fastify';
import { Resend } from 'resend';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { consumeMagicLinkToken, countRecentMagicLinkRequests, createMagicLinkToken, createSession, deleteSession } from '../store/auth.js';
import { SESSION_COOKIE } from './plugins/session.js';
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const resend = new Resend(env.RESEND_API_KEY);
export async function sendMagicLinkEmail(email: string, url: string): Promise<void> { await resend.emails.send({ from: 'EngageMend <login@engagemend.app>', to: email, subject: 'Seu link de acesso à EngageMend', html: `<p>Clique para entrar: <a href="${url}">${url}</a></p><p>Expira em 15 minutos.</p>` }); }
const bodySchema = z.object({ email: z.string().email() });
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/request-link', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'email inválido' });
    const { email } = parsed.data;
    if (await countRecentMagicLinkRequests(email, RATE_LIMIT_WINDOW_MS) >= 3) return reply.code(429).send({ error: 'muitos pedidos' });
    const { token } = await createMagicLinkToken(email);
    try { await sendMagicLinkEmail(email, `${env.PUBLIC_URL}/api/auth/confirm?token=${token}`); }
    catch (error) { logger.error({ err: error }, 'falha ao enviar magic link'); return reply.code(502).send({ error: 'falha ao enviar email' }); }
    return reply.code(202).send({ ok: true });
  });
  app.get('/api/auth/confirm', async (request, reply) => {
    const { token } = request.query as { token?: string };
    if (!token) return reply.code(400).send({ error: 'token ausente' });
    const result = await consumeMagicLinkToken(token);
    if (!result) return reply.code(401).send({ error: 'token inválido, expirado ou já usado' });
    const session = await createSession(result.userId);
    reply.setCookie(SESSION_COOKIE, session.id, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: session.expiresAt });
    return reply.redirect('/', 302);
  });
  app.post('/api/auth/logout', async (request, reply) => { const sessionId = request.cookies[SESSION_COOKIE]; if (sessionId) await deleteSession(sessionId); reply.clearCookie(SESSION_COOKIE, { path: '/' }); return reply.code(204).send(); });
}
