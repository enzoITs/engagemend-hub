import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { createMagicLinkToken, consumeMagicLinkToken, createSession, getSessionUser, deleteSession, countRecentMagicLinkRequests } from '../src/store/auth.js';

const email = () => `${randomUUID()}@teste.local`;

beforeEach(async () => {
  await prisma.memberEvent.deleteMany();
  await prisma.community.deleteMany();
  await prisma.job.deleteMany();
  await prisma.session.deleteMany();
  await prisma.magicLinkToken.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => { await disconnectPrisma(); });

describe('magic link e sessão', () => {
  it('token válido consome uma vez e cria usuário', async () => {
    const mail = email();
    const { token, expiresAt } = await createMagicLinkToken(mail);
    expect(token).toHaveLength(64);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const result = await consumeMagicLinkToken(token);
    expect(result).not.toBeNull();
    expect((await prisma.user.findUnique({ where: { email: mail } }))?.id).toBe(result!.userId);
  });
  it('token usado duas vezes falha', async () => {
    const { token } = await createMagicLinkToken(email());
    await consumeMagicLinkToken(token);
    expect(await consumeMagicLinkToken(token)).toBeNull();
  });
  it('token inexistente devolve null', async () => { expect(await consumeMagicLinkToken('lixo')).toBeNull(); });
  it('sessão fecha o ciclo e pode ser revogada', async () => {
    const { token } = await createMagicLinkToken(email());
    const { userId } = (await consumeMagicLinkToken(token))!;
    const session = await createSession(userId);
    expect((await getSessionUser(session.id))?.id).toBe(userId);
    await deleteSession(session.id);
    expect(await getSessionUser(session.id)).toBeNull();
  });
  it('conta pedidos recentes', async () => {
    const mail = email();
    await createMagicLinkToken(mail); await createMagicLinkToken(mail);
    expect(await countRecentMagicLinkRequests(mail, 15 * 60 * 1000)).toBe(2);
  });
});
