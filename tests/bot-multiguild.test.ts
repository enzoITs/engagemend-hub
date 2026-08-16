import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { resolveCommunityForGuild } from '../src/collector/bot.js';
beforeEach(async () => { await prisma.memberEvent.deleteMany(); await prisma.community.deleteMany(); await prisma.job.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany(); });
afterAll(async () => { await disconnectPrisma(); });
describe('resolveCommunityForGuild', () => {
  it('resolve comunidade ativa', async () => { const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } }); const c = await prisma.community.create({ data: { platform: 'discord', externalId: '999888777666555444', name: 'Guild', ownerId: user.id } }); expect((await resolveCommunityForGuild('999888777666555444'))?.id).toBe(c.id); });
  it('retorna null se nunca conectada', async () => { expect(await resolveCommunityForGuild('000111222333444555')).toBeNull(); });
  it('retorna null se desativada', async () => { const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } }); await prisma.community.create({ data: { platform: 'discord', externalId: '111222333444555666', name: 'Guild', ownerId: user.id, disabledAt: new Date() } }); expect(await resolveCommunityForGuild('111222333444555666')).toBeNull(); });
});
