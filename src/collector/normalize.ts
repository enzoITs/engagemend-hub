/**
 * Payload do Discord → `MemberEvent[]`.
 *
 * Este arquivo é PURO: nenhuma chamada de rede, nenhum acesso a banco, nenhum
 * `Date.now()`. Tudo o que varia entra por `NormalizeContext`. É o único jeito
 * de o backfill e o bot em tempo real produzirem exatamente o mesmo evento para
 * a mesma mensagem — e é o que torna a Frente D capaz de auditar a regra.
 *
 * O que este arquivo NÃO faz:
 *  - não aplica peso, teto diário ou decay (isso é o classificador, §1.2)
 *  - não hasheia (o hash entra por `ctx.hashMember`, mantendo a função pura)
 *  - não grava nada em lugar nenhum
 *  - não guarda texto de mensagem em `metadata` (§3) — só comprimento
 */

import type { ChannelCategory } from '../config/channels.js';
import type { EventType, MemberEvent } from '../types/scoring.js';

// ── Constantes de regra (§7) ────────────────────────────────────────────────

/** Abaixo disto, e sem anexo, a mensagem é ruído. */
export const MIN_MESSAGE_LENGTH = 20;

/** Acima disto a mensagem também conta como `message_substantial`. */
export const SUBSTANTIAL_MESSAGE_LENGTH = 120;

/** Mensagens do mesmo autor, mesmo canal, dentro desta janela contam como uma. */
export const BURST_WINDOW_MS = 60_000;

/** Janela em que mencionar alguém conta como `newcomer_welcomed`. */
export const NEWCOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** `voice_minutes` é creditado a cada bloco fechado deste tamanho. */
export const VOICE_BLOCK_MS = 10 * 60 * 1000;

/**
 * O que a janela de burst suprime.
 *
 * Só o sinal de VOLUME. Um clipe postado 10s depois de uma mensagem de texto
 * continua valendo `media_posted`, e uma resposta continua valendo
 * `reply_given` — senão a regra anti-ruído apaga sinal real junto com o ruído.
 * Para voltar ao comportamento literal do §7 ("conta como uma", tudo junto),
 * basta acrescentar os outros tipos a esta lista.
 */
export const BURST_SUPPRESSED: readonly EventType[] = ['message_sent', 'message_substantial'];

// ── Entradas (espelho estrutural do discord.js, sem depender dele) ──────────

export interface RawUserRef {
  id: string;
  isBot: boolean;
}

export interface RawAttachment {
  contentType?: string | null;
  name?: string | null;
}

export interface RawThreadRef {
  /** Canal-pai da thread. É ele que resolve a categoria. */
  parentChannelId: string;
  /** Mensagem que originou a thread, quando houver. */
  starterMessageId?: string | null;
}

export interface RawMessage {
  id: string;
  /** Em thread, o Discord já entrega o id da thread aqui. */
  channelId: string;
  author: RawUserRef;
  content: string;
  occurredAt: Date;
  attachments?: readonly RawAttachment[];
  mentions?: readonly RawUserRef[];
  repliedTo?: { messageId: string; author: RawUserRef } | null;
  thread?: RawThreadRef | null;
}

export interface RawReaction {
  messageId: string;
  channelId: string;
  reactor: RawUserRef;
  messageAuthor: RawUserRef;
  /** Nome do emoji, só para métrica. Não influencia a regra. */
  emoji?: string;
  occurredAt: Date;
  thread?: RawThreadRef | null;
}

export interface RawThreadCreate {
  threadId: string;
  parentChannelId: string;
  owner: RawUserRef;
  occurredAt: Date;
}

export interface RawForumSolution {
  threadId: string;
  parentChannelId: string;
  solutionMessageId: string;
  /** Quem escreveu a mensagem marcada como solução. */
  author: RawUserRef;
  occurredAt: Date;
}

export interface RawVoiceSession {
  member: RawUserRef;
  channelId: string;
  joinedAt: Date;
  leftAt: Date;
}

export interface RawInviteUse {
  inviteCode: string;
  /** Null quando o convite é vanity/desconhecido — nesse caso não há a quem creditar. */
  inviter: RawUserRef | null;
  newMember: RawUserRef;
  occurredAt: Date;
}

export interface NormalizeContext {
  /** HMAC-SHA256 com MEMBER_ID_SALT (§3). Injetado para manter a função pura. */
  hashMember: (discordId: string) => string;
  categoryOf: (channelId: string) => ChannelCategory;
  /**
   * Instante da última mensagem DESTE autor NESTE canal que já foi contada.
   * Quem mantém esse estado é o chamador (ver `BurstTracker`).
   */
  lastCountedAt?: Date | null;
  /**
   * Quando o membro entrou no servidor. Recebe o id bruto.
   * A janela de 24h é medida contra `occurredAt` da mensagem, não contra o
   * relógio — senão o backfill nunca detectaria boas-vindas históricas.
   */
  joinedAtOf?: (discordId: string) => Date | null | undefined;
}

// ── Helpers puros (exportados para teste) ───────────────────────────────────

const CUSTOM_EMOJI_RE = /<a?:[\w~]{2,32}:\d{17,20}>/gu;

/**
 * Emoji de teclado (keycap): dígito, cerquilha ou asterisco, seletor de
 * variação opcional, e o combining keycap U+20E3.
 *
 * As duas regexes abaixo são montadas por string de propósito: o padrão
 * contém U+FE0E, U+FE0F e U+200D, que são invisíveis no editor e somem em
 * qualquer copy-paste descuidado. Em escape ASCII eles sobrevivem.
 */
const KEYCAP_RE = new RegExp('[0-9#*]\\uFE0F?\\u20E3', 'gu');

/**
 * Extended_Pictographic + bandeiras (regional indicators) + tons de pele +
 * seletores de variação + ZWJ (o que cola família num glifo só).
 * `\p{Emoji}` NÃO é usado de propósito: ele casa com dígitos comuns.
 */
const EMOJI_CHAR_RE = new RegExp(
  '[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}\\u{1F3FB}-\\u{1F3FF}\\uFE0E\\uFE0F\\u200D]',
  'gu',
);

/** `true` se, tirados emojis e espaços, não sobra nada. */
export function isEmojiOnly(text: string): boolean {
  if (text.trim().length === 0) return false;
  const stripped = text
    .replace(CUSTOM_EMOJI_RE, '')
    .replace(KEYCAP_RE, '')
    .replace(EMOJI_CHAR_RE, '')
    .replace(/\s+/gu, '');
  return stripped.length === 0;
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'other';

const EXTENSIONS = new Map<string, AttachmentKind>([
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['gif', 'image'],
  ['webp', 'image'],
  ['bmp', 'image'],
  ['avif', 'image'],
  ['heic', 'image'],
  ['mp4', 'video'],
  ['mov', 'video'],
  ['webm', 'video'],
  ['mkv', 'video'],
  ['avi', 'video'],
  ['m4v', 'video'],
  ['mp3', 'audio'],
  ['ogg', 'audio'],
  ['wav', 'audio'],
  ['m4a', 'audio'],
  ['flac', 'audio'],
]);

export function attachmentKind(attachment: RawAttachment): AttachmentKind {
  const type = attachment.contentType?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';

  const ext = attachment.name?.toLowerCase().split('.').pop();
  return (ext ? EXTENSIONS.get(ext) : undefined) ?? 'other';
}

/** Vídeo ganha de imagem: é o anexo mais valioso e o único que vira gameplay_clip. */
function dominantMedia(attachments: readonly RawAttachment[]): AttachmentKind | null {
  let found: AttachmentKind | null = null;
  for (const attachment of attachments) {
    const kind = attachmentKind(attachment);
    if (kind === 'video') return 'video';
    if (kind === 'image') found = 'image';
  }
  return found;
}

function isBurstContinuation(occurredAt: Date, lastCountedAt: Date | null | undefined): boolean {
  if (!lastCountedAt) return false;
  const delta = occurredAt.getTime() - lastCountedAt.getTime();
  return delta >= 0 && delta < BURST_WINDOW_MS;
}

function isWithinNewcomerWindow(joinedAt: Date, occurredAt: Date): boolean {
  const delta = occurredAt.getTime() - joinedAt.getTime();
  return delta >= 0 && delta <= NEWCOMER_WINDOW_MS;
}

// ── Normalizadores ──────────────────────────────────────────────────────────

export function normalizeMessage(message: RawMessage, ctx: NormalizeContext): MemberEvent[] {
  const category = ctx.categoryOf(message.thread?.parentChannelId ?? message.channelId);
  if (category === 'ignored') return [];
  if (message.author.isBot) return [];

  const attachments = message.attachments ?? [];
  const hasAttachment = attachments.length > 0;
  const content = message.content.trim();
  const contentLength = content.length;

  // Anti-ruído (§7). As duas regras são condicionadas a "sem anexo": descartar
  // um clipe porque a legenda é um emoji jogaria fora o evento mais caro do §7.
  if (!hasAttachment && contentLength < MIN_MESSAGE_LENGTH) return [];
  if (!hasAttachment && isEmojiOnly(content)) return [];

  const events: MemberEvent[] = [];
  const authorHash = ctx.hashMember(message.author.id);
  const inBurst = isBurstContinuation(message.occurredAt, ctx.lastCountedAt);

  const repliedToAuthor = message.repliedTo?.author;
  const isRealReply =
    repliedToAuthor !== undefined &&
    repliedToAuthor.id !== message.author.id && // auto-resposta (§7)
    !repliedToAuthor.isBot;

  // O Discord menciona automaticamente o autor da mensagem respondida. Contar
  // isso como mention_received somaria influência duas vezes na mesma resposta.
  const seen = new Set<string>();
  const mentioned = (message.mentions ?? []).filter((user) => {
    if (user.isBot) return false;
    if (user.id === message.author.id) return false;
    if (user.id === repliedToAuthor?.id) return false;
    if (seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });

  const base = {
    source: 'discord' as const,
    occurredAt: message.occurredAt,
    contextId: message.channelId,
  };

  const metaBase = {
    channelCategory: category,
    contentLength,
    hasAttachment,
    isReply: isRealReply,
    mentionCount: mentioned.length,
    ...(message.thread ? { parentChannelId: message.thread.parentChannelId } : {}),
  };

  const suppressed = (eventType: EventType): boolean =>
    inBurst && BURST_SUPPRESSED.includes(eventType);

  if (!suppressed('message_sent')) {
    events.push({
      ...base,
      memberHash: authorHash,
      eventType: 'message_sent',
      refId: message.id,
      metadata: metaBase,
    });
  }

  if (contentLength > SUBSTANTIAL_MESSAGE_LENGTH && !suppressed('message_substantial')) {
    events.push({
      ...base,
      memberHash: authorHash,
      eventType: 'message_substantial',
      refId: message.id,
      metadata: metaBase,
    });
  }

  const media = dominantMedia(attachments);
  if (media !== null && !suppressed('media_posted')) {
    // §7: vídeo em canal gameplay é clipe — deriva do histórico de mensagens,
    // portanto retroativo, ao contrário de presença de jogo.
    const kind = media === 'video' && category === 'gameplay' ? 'gameplay_clip' : media;
    events.push({
      ...base,
      memberHash: authorHash,
      eventType: 'media_posted',
      refId: message.id,
      metadata: { ...metaBase, kind, attachmentCount: attachments.length },
    });
  }

  if (isRealReply && repliedToAuthor && !suppressed('reply_given')) {
    const targetHash = ctx.hashMember(repliedToAuthor.id);
    events.push({
      ...base,
      memberHash: authorHash,
      eventType: 'reply_given',
      refId: message.id,
      metadata: { ...metaBase, toHash: targetHash },
    });
    events.push({
      ...base,
      memberHash: targetHash,
      eventType: 'reply_received',
      // refId da RESPOSTA, não da mensagem original: cada resposta recebida
      // precisa ser um evento distinto sob o dedupe_key.
      refId: message.id,
      metadata: { ...metaBase, fromHash: authorHash },
    });
  }

  if (message.thread && message.thread.starterMessageId !== message.id) {
    events.push({
      ...base,
      memberHash: authorHash,
      eventType: 'thread_replied',
      refId: message.id,
      metadata: metaBase,
    });
  }

  for (const user of mentioned) {
    const mentionedHash = ctx.hashMember(user.id);
    events.push({
      ...base,
      memberHash: mentionedHash,
      eventType: 'mention_received',
      refId: message.id,
      metadata: { ...metaBase, fromHash: authorHash },
    });

    const joinedAt = ctx.joinedAtOf?.(user.id);
    if (joinedAt && isWithinNewcomerWindow(joinedAt, message.occurredAt)) {
      events.push({
        ...base,
        memberHash: authorHash,
        eventType: 'newcomer_welcomed',
        // Sintético: uma mensagem pode dar boas-vindas a vários novatos.
        refId: `welcome:${message.id}:${mentionedHash}`,
        metadata: { ...metaBase, welcomedHash: mentionedHash },
      });
    }
  }

  return events;
}

export function normalizeReaction(reaction: RawReaction, ctx: NormalizeContext): MemberEvent[] {
  const category = ctx.categoryOf(reaction.thread?.parentChannelId ?? reaction.channelId);
  if (category === 'ignored') return [];
  if (reaction.reactor.isBot) return [];
  // §7: reação na própria mensagem não conta — nem para quem deu, nem para quem recebeu.
  if (reaction.reactor.id === reaction.messageAuthor.id) return [];

  const reactorHash = ctx.hashMember(reaction.reactor.id);
  const base = {
    source: 'discord' as const,
    occurredAt: reaction.occurredAt,
    contextId: reaction.channelId,
  };
  const metadata = {
    channelCategory: category,
    messageId: reaction.messageId,
    ...(reaction.emoji ? { emoji: reaction.emoji } : {}),
  };

  const events: MemberEvent[] = [
    {
      ...base,
      memberHash: reactorHash,
      eventType: 'reaction_given',
      // Sem sintético: reagir com 5 emojis na mesma mensagem colapsa em 1 evento,
      // que é exatamente o anti-spam desejado.
      refId: reaction.messageId,
      metadata,
    },
  ];

  if (!reaction.messageAuthor.isBot) {
    events.push({
      ...base,
      memberHash: ctx.hashMember(reaction.messageAuthor.id),
      eventType: 'reaction_received',
      // Sintético por reator: sem isso o dedupe_key colapsaria 50 reações de 50
      // pessoas em 1 evento e o eixo influence perderia a diferença.
      refId: `reaction:${reaction.messageId}:${reactorHash}`,
      metadata: { ...metadata, fromHash: reactorHash },
    });
  }

  return events;
}

export function normalizeThreadCreate(
  thread: RawThreadCreate,
  ctx: NormalizeContext,
): MemberEvent[] {
  const category = ctx.categoryOf(thread.parentChannelId);
  if (category === 'ignored') return [];
  if (thread.owner.isBot) return [];

  return [
    {
      memberHash: ctx.hashMember(thread.owner.id),
      source: 'discord',
      eventType: 'thread_started',
      occurredAt: thread.occurredAt,
      contextId: thread.parentChannelId,
      refId: thread.threadId,
      metadata: { channelCategory: category, threadId: thread.threadId },
    },
  ];
}

export function normalizeForumSolution(
  solution: RawForumSolution,
  ctx: NormalizeContext,
): MemberEvent[] {
  const category = ctx.categoryOf(solution.parentChannelId);
  if (category === 'ignored') return [];
  if (solution.author.isBot) return [];

  return [
    {
      memberHash: ctx.hashMember(solution.author.id),
      source: 'discord',
      eventType: 'forum_solution',
      occurredAt: solution.occurredAt,
      contextId: solution.threadId,
      refId: solution.solutionMessageId,
      metadata: { channelCategory: category, threadId: solution.threadId },
    },
  ];
}

/**
 * Uma sessão de voz vira um evento por bloco FECHADO de 10 minutos.
 * 6 minutos não geram nada; 25 minutos geram 2.
 *
 * `refId = voice:{channelId}:{bucket10min}`, onde o bucket é o índice de
 * 10 minutos do relógio em que o bloco começou — reprocessar a mesma sessão
 * produz os mesmos refIds, e blocos consecutivos nunca colidem.
 *
 * Não é retroativo: o Discord não guarda log de voiceStateUpdate (§9).
 */
export function normalizeVoiceSession(
  session: RawVoiceSession,
  ctx: NormalizeContext,
): MemberEvent[] {
  const category = ctx.categoryOf(session.channelId);
  if (category === 'ignored') return [];
  if (session.member.isBot) return [];

  const start = session.joinedAt.getTime();
  const durationMs = session.leftAt.getTime() - start;
  const blocks = Math.floor(durationMs / VOICE_BLOCK_MS);
  if (blocks <= 0) return [];

  const memberHash = ctx.hashMember(session.member.id);
  const events: MemberEvent[] = [];

  for (let i = 0; i < blocks; i += 1) {
    const blockStart = start + i * VOICE_BLOCK_MS;
    const bucket = Math.floor(blockStart / VOICE_BLOCK_MS);
    events.push({
      memberHash,
      source: 'discord',
      eventType: 'voice_minutes',
      // Creditado no fim do bloco: o membro só "ganhou" os 10 minutos ao completá-los.
      occurredAt: new Date(blockStart + VOICE_BLOCK_MS),
      contextId: session.channelId,
      refId: `voice:${session.channelId}:${bucket}`,
      metadata: { channelCategory: category, blockIndex: i, minutes: VOICE_BLOCK_MS / 60_000 },
    });
  }

  return events;
}

/**
 * Crédito vai para quem CONVIDOU. Não é retroativo: só existe se o bot estava
 * cacheando `invite.uses` no momento do guildMemberAdd (§9).
 */
export function normalizeInviteUse(use: RawInviteUse, ctx: NormalizeContext): MemberEvent[] {
  if (!use.inviter || use.inviter.isBot) return [];
  if (use.inviter.id === use.newMember.id) return [];

  const newMemberHash = ctx.hashMember(use.newMember.id);
  return [
    {
      memberHash: ctx.hashMember(use.inviter.id),
      source: 'discord',
      eventType: 'invite_used',
      occurredAt: use.occurredAt,
      refId: `invite:${use.inviteCode}:${newMemberHash}`,
      metadata: { inviteCode: use.inviteCode, invitedHash: newMemberHash },
    },
  ];
}

/**
 * Estado da janela de burst. Vive fora de `normalize` de propósito: a função
 * continua pura e o chamador decide o ciclo de vida do cache.
 *
 * O backfill pagina do mais novo para o mais antigo — cada página precisa ser
 * ordenada em ordem crescente antes de normalizar, senão a janela de 60s é
 * avaliada ao contrário.
 */
export class BurstTracker {
  readonly #lastCountedAt = new Map<string, number>();

  #key(authorId: string, channelId: string): string {
    return `${authorId}:${channelId}`;
  }

  lastCountedAt(authorId: string, channelId: string): Date | null {
    const at = this.#lastCountedAt.get(this.#key(authorId, channelId));
    return at === undefined ? null : new Date(at);
  }

  /** Chamar só quando a mensagem realmente virou `message_sent`. */
  commit(authorId: string, channelId: string, occurredAt: Date): void {
    this.#lastCountedAt.set(this.#key(authorId, channelId), occurredAt.getTime());
  }

  /** Descarta entradas velhas para o cache não crescer sem limite no bot. */
  prune(olderThan: Date): void {
    const cutoff = olderThan.getTime();
    for (const [key, at] of this.#lastCountedAt) {
      if (at < cutoff) this.#lastCountedAt.delete(key);
    }
  }

  get size(): number {
    return this.#lastCountedAt.size;
  }
}
