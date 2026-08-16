import { readFileSync } from 'node:fs';

import { prisma } from '../lib/prisma.js';
import { hashMember, rememberIdentities, type IdentityInput } from '../store/identity.js';
import { insertEvents, type InsertResult } from '../store/events.js';
import type { MemberEvent } from '../types/scoring.js';

/**
 * Ingestão do schema universal produzido por `engagemend-youtube/export_events.py`
 * (um evento por comentário do YouTube, já classificado via Groq).
 *
 * Mapeia pra `MemberEvent` do jeito que `src/classifier/weights.ts` espera:
 * todo comentário vira `comment_sent`; comentário substancial (categoria
 * `contribuicao_valor`/`critica_construtiva`) também vira `comment_substantial`
 * — os dois com o mesmo `refId`, então contam como eventos distintos pro
 * `dedupe_key` (`memberHash, eventType, refId`).
 *
 * `author_id` aqui é `authorDisplayName` da API do YouTube — o extrator não
 * captura `authorChannelId` (limitação herdada do pipeline Python). Rename de
 * canal quebra a identidade entre execuções; aceito por ora, é o mesmo dado
 * que já existe classificado em produção.
 */

export interface UniversalCommentEvent {
  event_id: string;
  platform: string;
  author_id: string;
  author_display_name: string;
  content_id: string;
  published_at: string;
  quality_score: number;
  categorias: string;
}

const SUBSTANTIAL_CATEGORIES = new Set(['contribuicao_valor', 'critica_construtiva']);

function isSubstantial(categorias: string): boolean {
  return categorias
    .split(',')
    .map((c) => c.trim())
    .some((c) => SUBSTANTIAL_CATEGORIES.has(c));
}

export function loadUniversalEvents(filePath: string): UniversalCommentEvent[] {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as UniversalCommentEvent[];
}

/** Resolve (ou cria) a `Community` YouTube pelo `(platform, externalId)`. */
export async function resolveYoutubeCommunity(
  channelId: string,
  channelName: string,
): Promise<string> {
  const community = await prisma.community.upsert({
    where: { platform_externalId: { platform: 'youtube', externalId: channelId } },
    create: { platform: 'youtube', externalId: channelId, name: channelName },
    update: { name: channelName, syncedAt: new Date() },
  });
  return community.id;
}

export interface IngestYoutubeResult extends InsertResult {
  identities: number;
}

export async function ingestYoutubeEvents(
  comments: readonly UniversalCommentEvent[],
  channelId: string,
  channelName: string,
): Promise<IngestYoutubeResult> {
  const communityId = await resolveYoutubeCommunity(channelId, channelName);

  const identityByAuthor = new Map<string, IdentityInput>();
  for (const comment of comments) {
    identityByAuthor.set(comment.author_id, {
      platform: 'youtube',
      externalUserId: comment.author_id,
      username: comment.author_display_name || comment.author_id,
      isBot: false,
    });
  }
  await rememberIdentities([...identityByAuthor.values()]);

  const events: MemberEvent[] = [];
  for (const comment of comments) {
    const memberHash = hashMember('youtube', comment.author_id);
    const metadata = {
      qualityScore: comment.quality_score,
      qualityMultiplier: comment.quality_score,
      categorias: comment.categorias,
    };
    const occurredAt = new Date(comment.published_at);

    events.push({
      memberHash,
      source: 'youtube',
      eventType: 'comment_sent',
      occurredAt,
      contextId: comment.content_id,
      refId: comment.event_id,
      metadata,
    });

    if (isSubstantial(comment.categorias)) {
      events.push({
        memberHash,
        source: 'youtube',
        eventType: 'comment_substantial',
        occurredAt,
        contextId: comment.content_id,
        refId: comment.event_id,
        metadata,
      });
    }
  }

  const result = await insertEvents(events, channelId, communityId);
  return { ...result, identities: identityByAuthor.size };
}
