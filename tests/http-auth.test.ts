import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
const { emailSend } = vi.hoisted(() => ({ emailSend: vi.fn(async () => ({ data: {}, error: null })) }));
vi.mock('resend', () => ({ Resend: class { emails = { send: emailSend }; } }));
const { buildServer } = await import('../src/http/server.js');
beforeEach(async () => { await prisma.memberEvent.deleteMany(); await prisma.community.deleteMany(); await prisma.job.deleteMany(); await prisma.session.deleteMany(); await prisma.magicLinkToken.deleteMany(); await prisma.user.deleteMany(); emailSend.mockClear(); });
afterAll(async () => { await disconnectPrisma(); });
describe('request-link', () => {
  it('envia email e devolve 202', async () => { const app = buildServer(); const email = `${randomUUID()}@teste.local`; const response = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email } }); expect(response.statusCode).toBe(202); expect(emailSend).toHaveBeenCalled(); expect((emailSend.mock.calls[0] as any)[0].to).toBe(email); });
  it('rate-limita em 3 pedidos', async () => { const app = buildServer(); const email = `${randomUUID()}@teste.local`; for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email } }); expect((await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email } })).statusCode).toBe(429); });
});
describe('confirm e logout', () => {
  it('token válido cria sessão e cookie', async () => { const app = buildServer(); const email = `${randomUUID()}@teste.local`; await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email } }); const token = ((emailSend.mock.calls[0] as any)[0].html as string).match(/token=([0-9a-f]{64})/)![1]; const response = await app.inject({ method: 'GET', url: `/api/auth/confirm?token=${token}` }); expect(response.statusCode).toBe(302); expect(response.cookies.some((c) => c.name === 'engagemend_session')).toBe(true); });
  it('token inválido devolve 401', async () => { expect((await buildServer().inject({ method: 'GET', url: '/api/auth/confirm?token=lixo' })).statusCode).toBe(401); });
  it('logout limpa sessão', async () => { const app = buildServer(); const email = `${randomUUID()}@teste.local`; await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email } }); const token = ((emailSend.mock.calls[0] as any)[0].html as string).match(/token=([0-9a-f]{64})/)![1]; const confirm = await app.inject({ method: 'GET', url: `/api/auth/confirm?token=${token}` }); const cookie = confirm.cookies.find((c) => c.name === 'engagemend_session')!.value; const response = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { engagemend_session: cookie } }); expect(response.statusCode).toBe(204); });
});
