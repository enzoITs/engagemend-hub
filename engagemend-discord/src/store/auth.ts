import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export async function createMagicLinkToken(email: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await prisma.magicLinkToken.create({ data: { email, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function consumeMagicLinkToken(token: string): Promise<{ userId: string } | null> {
  const record = await prisma.magicLinkToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) return null;
  const user = await prisma.user.upsert({ where: { email: record.email }, create: { email: record.email }, update: {} });
  await prisma.magicLinkToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return { userId: user.id };
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({ data: { userId, expiresAt } });
  return { id: session.id, expiresAt };
}

export async function getSessionUser(sessionId: string): Promise<{ id: string; email: string } | null> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return { id: session.user.id, email: session.user.email };
}

export async function getOrCreateLocalUser(): Promise<{ id: string; email: string }> {
  const user = await prisma.user.upsert({
    where: { email: 'local@engagemend.test' },
    create: { email: 'local@engagemend.test' },
    update: {},
  });
  return { id: user.id, email: user.email };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function countRecentMagicLinkRequests(email: string, sinceMs: number): Promise<number> {
  return prisma.magicLinkToken.count({ where: { email, createdAt: { gte: new Date(Date.now() - sinceMs) } } });
}
