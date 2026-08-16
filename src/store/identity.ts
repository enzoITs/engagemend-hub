import { createHmac } from 'node:crypto';

import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

/**
 * Pseudonimização (§3).
 *
 * `member_identity` é a ÚNICA tabela que liga hash a pessoa. Todo o resto do
 * sistema — eventos, perfis, transições, export — opera sobre o hash.
 */

/**
 * HMAC-SHA256(`platform:externalUserId`, MEMBER_ID_SALT). Determinístico dentro
 * do mesmo sal. Namespaced por plataforma de propósito (§ fusão YouTube): a
 * mesma pessoa em Discord e YouTube vira hashes diferentes, sem match de
 * identidade entre plataformas.
 */
export function hashMember(platform: string, externalUserId: string): string {
  return createHmac('sha256', env.MEMBER_ID_SALT)
    .update(`${platform}:${externalUserId}`)
    .digest('hex');
}

export interface IdentityInput {
  /** Default `'discord'` — coletor Discord nunca precisa passar isto. */
  platform?: string;
  /** Default `discordId`. Obrigatório (via `externalUserId` ou `discordId`) um dos dois. */
  externalUserId?: string;
  discordId?: string;
  username: string;
  displayName?: string | null;
  isBot: boolean;
  joinedAt?: Date | null;
}

/**
 * Ids já gravados neste processo. Evita um round-trip por mensagem — o custo
 * de errar é zero, porque o upsert é idempotente de qualquer jeito.
 */
const persisted = new Set<string>();

export async function rememberIdentity(input: IdentityInput): Promise<string> {
  const platform = input.platform ?? 'discord';
  const externalUserId = input.externalUserId ?? input.discordId;
  if (!externalUserId) {
    throw new Error('rememberIdentity: precisa de externalUserId ou discordId');
  }

  const memberHash = hashMember(platform, externalUserId);
  const cacheKey = `${platform}:${externalUserId}`;

  // `joinedAt` só aparece em guildMemberAdd e no backfill de membros; quando
  // vem, vale a escrita mesmo que o id já esteja no cache.
  if (persisted.has(cacheKey) && input.joinedAt == null) return memberHash;

  await prisma.memberIdentity.upsert({
    where: { memberHash },
    create: {
      memberHash,
      platform,
      externalUserId,
      discordId: input.discordId ?? null,
      username: input.username,
      displayName: input.displayName ?? null,
      isBot: input.isBot,
      joinedAt: input.joinedAt ?? null,
    },
    update: {
      username: input.username,
      displayName: input.displayName ?? null,
      isBot: input.isBot,
      ...(input.joinedAt ? { joinedAt: input.joinedAt } : {}),
    },
  });

  persisted.add(cacheKey);
  return memberHash;
}

export async function rememberIdentities(inputs: readonly IdentityInput[]): Promise<void> {
  const unique = new Map<string, IdentityInput>();
  for (const input of inputs) {
    const key = `${input.platform ?? 'discord'}:${input.externalUserId ?? input.discordId}`;
    unique.set(key, input);
  }
  for (const input of unique.values()) await rememberIdentity(input);
}

/** Só para o `--reveal` do relatório (§11). Loga um aviso lá, não aqui. */
export async function revealUsernames(
  memberHashes: readonly string[],
): Promise<Map<string, string>> {
  const rows = await prisma.memberIdentity.findMany({
    where: { memberHash: { in: [...memberHashes] } },
    select: { memberHash: true, username: true, displayName: true },
  });

  return new Map(rows.map((row) => [row.memberHash, row.displayName ?? row.username]));
}

/** Limpa o cache de processo. Existe para teste. */
export function resetIdentityCache(): void {
  persisted.clear();
}
