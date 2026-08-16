import { readFileSync } from 'node:fs';

import { prisma } from '../lib/prisma.js';
import { hashMember, rememberIdentities, type IdentityInput } from '../store/identity.js';
import { insertEvents, type InsertResult } from '../store/events.js';
import type { MemberEvent } from '../types/scoring.js';

/**
 * Ingestão do contrato v1.0.0 produzido por `engagemend-whatsapp/src/cli.py`
 * (um evento por mensagem de grupo, já pseudonimizado via HMAC própria do
 * pipeline — `author_hash`/`mentioned_hashes` nunca chegam aqui como
 * telefone ou nome, ver `engagemend-whatsapp/README.md`).
 *
 * `author_hash` do pipeline vira o `externalUserId` do sistema — ele já é
 * irreversível sem a `ANON_HMAC_KEY` do pipeline, então usamos ele direto
 * como namespace de identidade; `hashMember('whatsapp', authorHash)` aplica
 * uma segunda camada com `MEMBER_ID_SALT`, consistente com Discord/YouTube.
 *
 * A fonte não tem metadado de resposta citada (lacuna documentada no README
 * do pipeline) — por isso não existe `reply_given`/`reply_received` aqui, e
 * sem classificador de qualidade (que o YouTube tem via Groq), `char_count`
 * é o único proxy disponível pra `message_substantial`.
 */

export interface WhatsAppMessageRecord {
  message_id: string;
  group_hash: string;
  author_hash: string | null;
  timestamp: string;
  message_type:
    | 'text'
    | 'media_image'
    | 'media_video'
    | 'media_audio'
    | 'media_sticker'
    | 'media_document'
    | 'media_gif'
    | 'location'
    | 'contact_card'
    | 'poll'
    | 'system'
    | 'deleted';
  char_count: number;
  word_count: number;
  has_mention: boolean;
  mentioned_hashes: string[];
  has_url: boolean;
  is_edited: boolean;
  source_platform: 'android' | 'ios';
  seq_in_group: number;
  parser_version: string;
}

const MEDIA_TYPES = new Set([
  'media_image',
  'media_video',
  'media_audio',
  'media_sticker',
  'media_document',
  'media_gif',
]);
const SKIPPED_TYPES = new Set(['system', 'deleted']);

/** Chute de calibração (mesma lógica de `weights.ts`) — recalibrar contra grupo real. */
const SUBSTANTIAL_CHAR_COUNT = 120;

export function loadWhatsAppRecords(filePath: string): WhatsAppMessageRecord[] {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as WhatsAppMessageRecord[];
}

/** Resolve (ou cria) a `Community` WhatsApp pelo `(platform, groupHash)`. */
export async function resolveWhatsappCommunity(
  groupHash: string,
  groupName: string,
  ownerId: string,
): Promise<string> {
  const community = await prisma.community.upsert({
    where: { platform_externalId: { platform: 'whatsapp', externalId: groupHash } },
    create: {
      platform: 'whatsapp',
      externalId: groupHash,
      name: groupName,
      ownerId,
      syncState: 'sincronizando',
    },
    update: { name: groupName, syncedAt: new Date() },
  });
  return community.id;
}

export interface IngestWhatsappResult extends InsertResult {
  identities: number;
}

export async function ingestWhatsappMessages(
  messages: readonly WhatsAppMessageRecord[],
  groupHash: string,
  communityId: string,
): Promise<IngestWhatsappResult> {
  const identityByAuthor = new Map<string, IdentityInput>();
  for (const msg of messages) {
    if (msg.author_hash) {
      identityByAuthor.set(msg.author_hash, {
        platform: 'whatsapp',
        externalUserId: msg.author_hash,
        username: msg.author_hash.slice(0, 8),
        isBot: false,
      });
    }
    if (msg.has_mention) {
      for (const mentioned of msg.mentioned_hashes) {
        if (!identityByAuthor.has(mentioned)) {
          identityByAuthor.set(mentioned, {
            platform: 'whatsapp',
            externalUserId: mentioned,
            username: mentioned.slice(0, 8),
            isBot: false,
          });
        }
      }
    }
  }
  await rememberIdentities([...identityByAuthor.values()]);

  const events: MemberEvent[] = [];
  for (const msg of messages) {
    if (SKIPPED_TYPES.has(msg.message_type) || !msg.author_hash) continue;

    const memberHash = hashMember('whatsapp', msg.author_hash);
    const occurredAt = new Date(msg.timestamp);
    const metadata = {
      charCount: msg.char_count,
      wordCount: msg.word_count,
      sourcePlatform: msg.source_platform,
    };

    if (MEDIA_TYPES.has(msg.message_type)) {
      events.push({
        memberHash,
        source: 'whatsapp',
        eventType: 'media_posted',
        occurredAt,
        contextId: groupHash,
        refId: msg.message_id,
        metadata,
      });
    } else {
      events.push({
        memberHash,
        source: 'whatsapp',
        eventType: 'message_sent',
        occurredAt,
        contextId: groupHash,
        refId: msg.message_id,
        metadata,
      });

      if (msg.char_count >= SUBSTANTIAL_CHAR_COUNT) {
        events.push({
          memberHash,
          source: 'whatsapp',
          eventType: 'message_substantial',
          occurredAt,
          contextId: groupHash,
          refId: msg.message_id,
          metadata,
        });
      }
    }

    if (msg.has_mention) {
      for (const mentioned of msg.mentioned_hashes) {
        const mentionedHash = hashMember('whatsapp', mentioned);
        events.push({
          memberHash: mentionedHash,
          source: 'whatsapp',
          eventType: 'mention_received',
          occurredAt,
          contextId: groupHash,
          refId: `${msg.message_id}:${mentioned}`,
          metadata: { fromAuthorHash: msg.author_hash },
        });
      }
    }
  }

  const result = await insertEvents(events, groupHash, communityId);
  return { ...result, identities: identityByAuthor.size };
}
