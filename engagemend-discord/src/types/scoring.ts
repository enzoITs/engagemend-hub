/**
 * ESPELHO do contrato compartilhado (`/lib/types/scoring.ts` do monorepo principal).
 *
 * Divergência entre os dois arquivos quebra a ingestão por CSV da Frente C.
 * Não editar aqui sem editar lá.
 *
 * ── PENDÊNCIA DE VERIFICAÇÃO ────────────────────────────────────────────────
 * `EngagementLevel`, `EventSource` e `MemberEvent` vieram literalmente do §5 do
 * prompt de M1. `EventType` NÃO estava no §5 — foi derivado da tabela de
 * eventos do §7. Conferir os 14 nomes abaixo contra o contrato principal antes
 * do primeiro export para a Frente C.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type EngagementLevel = 1 | 2 | 3 | 4 | 5;

export type EventSource = 'discord' | 'youtube' | 'whatsapp' | 'csv' | 'manual';

export type EventType =
  | 'reaction_given'
  | 'message_sent'
  | 'message_substantial'
  | 'media_posted'
  | 'reply_given'
  | 'thread_started'
  | 'thread_replied'
  | 'reaction_received'
  | 'reply_received'
  | 'mention_received'
  | 'forum_solution'
  | 'voice_minutes'
  | 'newcomer_welcomed'
  | 'invite_used'
  | 'comment_sent'
  | 'comment_substantial'
  | 'comment_reply_received';

export interface MemberEvent {
  memberHash: string;
  source: EventSource;
  eventType: EventType;
  occurredAt: Date;
  contextId?: string; // channel_id
  refId?: string; // message_id
  metadata: Record<string, unknown>;
}
