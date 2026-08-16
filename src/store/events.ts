import type { Prisma } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import type { MemberEvent } from '../types/scoring.js';

/**
 * Escrita no event store.
 *
 * `member_events` é APPEND-ONLY (§1.3). Este arquivo é o único lugar do sistema
 * que escreve nela, e só faz INSERT. Se algum dia aparecer um `update` ou
 * `delete` aqui, o recompute com pesos novos deixa de ser barato e a decisão
 * inteira do §1 vai junto.
 */

/** Postgres aceita bem mais, mas lote grande demais estoura o limite de parâmetros. */
const CHUNK_SIZE = 500;

export interface InsertResult {
  /** Quantos eventos entraram de fato. */
  inserted: number;
  /** Quantos foram barrados pelo `dedupe_key` — reprocessamento, não erro. */
  skipped: number;
}

export async function insertEvents(
  events: readonly MemberEvent[],
  guildId: string,
  communityId?: string,
): Promise<InsertResult> {
  if (events.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;

  for (let offset = 0; offset < events.length; offset += CHUNK_SIZE) {
    const chunk = events.slice(offset, offset + CHUNK_SIZE);

    const result = await prisma.memberEvent.createMany({
      data: chunk.map((event) => ({
        memberHash: event.memberHash,
        guildId,
        communityId: communityId ?? null,
        source: event.source,
        eventType: event.eventType,
        contextId: event.contextId ?? null,
        refId: event.refId ?? null,
        metadata: (event.metadata ?? {}) as Prisma.InputJsonObject,
        occurredAt: event.occurredAt,
      })),
      // É isto que faz rodar o backfill duas vezes não duplicar nada (§6).
      skipDuplicates: true,
    });

    inserted += result.count;
  }

  const skipped = events.length - inserted;
  if (skipped > 0) {
    logger.debug({ inserted, skipped }, 'eventos duplicados ignorados pelo dedupe_key');
  }

  return { inserted, skipped };
}

export async function countEvents(guildId?: string): Promise<number> {
  return prisma.memberEvent.count(guildId ? { where: { guildId } } : undefined);
}

/** Último evento gravado — usado pelo `collect` para mostrar sinal de vida. */
export async function latestEventAt(guildId: string): Promise<Date | null> {
  const row = await prisma.memberEvent.findFirst({
    where: { guildId },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true },
  });
  return row?.occurredAt ?? null;
}
