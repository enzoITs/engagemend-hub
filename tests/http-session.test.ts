import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { createSession } from '../src/store/auth.js';
import { buildServer } from '../src/http/server.js';
beforeEach(async () => { await prisma.memberEvent.deleteMany(); await prisma.community.deleteMany(); await prisma.job.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany(); });
afterAll(async () => { await disconnectPrisma(); });
describe('plugin de sessão', () => {
  it('sem cookie devolve 401', async () => { const app = buildServer(); app.get('/protegida', async (request) => ({ userId: request.user.id })); expect((await app.inject({ method: 'GET', url: '/protegida' })).statusCode).toBe(401); });
  it('cookie válido decora request.user', async () => { const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } }); const session = await createSession(user.id); const app = buildServer(); app.get('/protegida', async (request) => ({ userId: request.user.id })); const response = await app.inject({ method: 'GET', url: '/protegida', cookies: { engagemend_session: session.id } }); expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ userId: user.id }); });
  it('cookie inválido devolve 401', async () => { const app = buildServer(); app.get('/protegida', async (request) => ({ userId: request.user.id })); expect((await app.inject({ method: 'GET', url: '/protegida', cookies: { engagemend_session: 'lixo' } })).statusCode).toBe(401); });
});
