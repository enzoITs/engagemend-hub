import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { createSession } from '../src/store/auth.js';
vi.mock('../src/http/discord-guild-info.js', () => ({ fetchDiscordGuildName: vi.fn(async (id: string) => `Guild ${id}`) }));
const { fetchDiscordGuildName } = await import('../src/http/discord-guild-info.js'); const { buildServer } = await import('../src/http/server.js');
async function auth() { const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } }); return (await createSession(user.id)).id; }
beforeEach(async () => { await prisma.memberEvent.deleteMany(); await prisma.community.deleteMany(); await prisma.job.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany(); vi.mocked(fetchDiscordGuildName).mockClear(); }); afterAll(async () => { await disconnectPrisma(); });
describe('Discord OAuth', () => {
  it('devolve URL de convite', async () => { const cookie = await auth(); const response = await buildServer().inject({ method: 'GET', url: '/api/discord/invite-url', cookies: { engagemend_session: cookie } }); expect(response.statusCode).toBe(200); expect(response.json().url).toContain('scope=bot'); });
  it('callback cria comunidade e job', async () => { const cookie = await auth(); const response = await buildServer().inject({ method: 'GET', url: '/api/discord/callback?guild_id=123456789012345678', cookies: { engagemend_session: cookie } }); expect(response.statusCode).toBe(302); expect((await prisma.community.findUnique({ where: { platform_externalId: { platform: 'discord', externalId: '123456789012345678' } } }))?.syncState).toBe('sincronizando'); expect(await prisma.job.findFirst({ where: { kind: 'discord_backfill' } })).not.toBeNull(); });
  it('guild duplicado devolve 409', async () => { const first = await auth(); await buildServer().inject({ method: 'GET', url: '/api/discord/callback?guild_id=999999999999999999', cookies: { engagemend_session: first } }); const second = await auth(); expect((await buildServer().inject({ method: 'GET', url: '/api/discord/callback?guild_id=999999999999999999', cookies: { engagemend_session: second } })).statusCode).toBe(409); });
});
