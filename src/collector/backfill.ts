import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  ChannelType,
  type AnyThreadChannel,
  type Guild,
  type GuildBasedChannel,
  type Message,
  type TextChannel,
} from 'discord.js';

import { resolveChannelCategory } from '../config/channels.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { insertEvents } from '../store/events.js';
import { hashMember, rememberIdentities, type IdentityInput } from '../store/identity.js';
import type { MemberEvent } from '../types/scoring.js';
import { threadRefOf, toRawMessage, toUserRef } from './bot.js';
import {
  BurstTracker,
  normalizeMessage,
  normalizeReaction,
  normalizeThreadCreate,
  type NormalizeContext,
} from './normalize.js';

/**
 * Varredura histórica.
 *
 * O que é retroativo: mensagem, anexo, resposta, menção, thread, reação.
 * O que NÃO é: voz e convite (§9) — não existe log para reler, e é por isso
 * que o coletor em tempo real vinha antes desta seção.
 *
 * Reprocessar é seguro: o `dedupe_key` barra tudo o que já entrou, e o
 * checkpoint em disco evita repaginar o que já foi lido.
 */

export const BACKFILL_STATE_PATH = '.backfill-state.json';

const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** `reaction.users.fetch` devolve no máximo isto por request. */
const REACTION_USERS_PAGE = 100;

export interface BackfillOptions {
  channelIds: readonly string[];
  all: boolean;
  /** Teto de mensagens lidas por canal. */
  limit: number;
  since: Date | null;
  reactions: boolean;
  threads: boolean;
  reset: boolean;
}

export interface ChannelResult {
  channelId: string;
  name: string;
  messages: number;
  events: number;
  inserted: number;
  skipped: number;
  done: boolean;
}

export interface BackfillSummary {
  channels: ChannelResult[];
  totals: { messages: number; events: number; inserted: number; skipped: number };
}

// ── Checkpoint em disco ─────────────────────────────────────────────────────

interface ChannelCheckpoint {
  /** Id da mensagem mais antiga já lida — é o cursor `before` da próxima página. */
  oldestSeenId: string | null;
  done: boolean;
  messages: number;
  updatedAt: string;
}

interface BackfillState {
  version: 1;
  channels: Record<string, ChannelCheckpoint>;
}

const EMPTY_STATE: BackfillState = { version: 1, channels: {} };

export function loadState(path = BACKFILL_STATE_PATH): BackfillState {
  if (!existsSync(path)) return structuredClone(EMPTY_STATE);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BackfillState;
    if (parsed.version !== 1 || typeof parsed.channels !== 'object') {
      logger.warn({ path }, 'checkpoint em formato desconhecido — recomeçando do zero');
      return structuredClone(EMPTY_STATE);
    }
    return parsed;
  } catch (error) {
    logger.warn({ err: error, path }, 'checkpoint ilegível — recomeçando do zero');
    return structuredClone(EMPTY_STATE);
  }
}

export function saveState(state: BackfillState, path = BACKFILL_STATE_PATH): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ── Rate limit ──────────────────────────────────────────────────────────────

/**
 * O REST do discord.js já faz a contabilidade proativa de bucket a partir dos
 * headers `X-RateLimit-*` e segura a requisição antes de estourar. Este retry
 * cobre o que sobra: 429 global, 5xx e queda de rede.
 */
function retryAfterMs(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { timeToReset?: unknown; retryAfter?: unknown };
  if (typeof candidate.timeToReset === 'number') return candidate.timeToReset;
  if (typeof candidate.retryAfter === 'number') return candidate.retryAfter * 1000;
  return null;
}

async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  let backoff = INITIAL_BACKOFF_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error;
      const wait = retryAfterMs(error) ?? backoff;
      logger.warn({ label, attempt, waitMs: wait, err: error }, 'request falhou — repetindo');
      await sleep(wait);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  throw new Error('inalcançável');
}

// ── Seleção de canais ───────────────────────────────────────────────────────

function supportsMessages(channel: GuildBasedChannel): channel is TextChannel {
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.isThread()
  );
}

function supportsThreads(channel: GuildBasedChannel): boolean {
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.GuildForum
  );
}

async function resolveTargets(
  guild: Guild,
  options: BackfillOptions,
): Promise<GuildBasedChannel[]> {
  const all = await guild.channels.fetch();
  const targets: GuildBasedChannel[] = [];

  for (const channel of all.values()) {
    if (!channel) continue;
    if (!supportsMessages(channel) && !supportsThreads(channel)) continue;

    if (!options.all && !options.channelIds.includes(channel.id)) continue;

    if (resolveChannelCategory(channel.id) === 'ignored') {
      logger.info({ channel: channel.name, id: channel.id }, 'canal ignored — pulando');
      continue;
    }

    targets.push(channel);
  }

  const missing = options.channelIds.filter((id) => !targets.some((c) => c.id === id));
  for (const id of missing) {
    logger.warn({ id }, 'canal não encontrado, sem suporte a mensagem, ou ignored');
  }

  return targets;
}

// ── Varredura ───────────────────────────────────────────────────────────────

function baseContext(guild: Guild): NormalizeContext {
  return {
    hashMember: (discordId) => hashMember('discord', discordId),
    categoryOf: (channelId) => resolveChannelCategory(channelId),
    joinedAtOf: (discordId) => guild.members.cache.get(discordId)?.joinedAt ?? null,
  };
}

function identityOf(user: { id: string; username: string; displayName: string; bot: boolean }) {
  return {
    discordId: user.id,
    username: user.username,
    displayName: user.displayName,
    isBot: user.bot,
  } satisfies IdentityInput;
}

async function collectReactionEvents(
  message: Message<true>,
  ctx: NormalizeContext,
  events: MemberEvent[],
  identities: IdentityInput[],
): Promise<void> {
  for (const reaction of message.reactions.cache.values()) {
    if (reaction.count > REACTION_USERS_PAGE) {
      // Não silenciar o corte: 300 reações viram 100 eventos e o eixo influence
      // fica menor do que a realidade.
      logger.warn(
        { messageId: message.id, emoji: reaction.emoji.name, count: reaction.count },
        `mais de ${REACTION_USERS_PAGE} reatores — só os primeiros ${REACTION_USERS_PAGE} entram`,
      );
    }

    const users = await withRetry('reaction.users.fetch', () =>
      reaction.users.fetch({ limit: REACTION_USERS_PAGE }),
    );

    for (const user of users.values()) {
      if (user.bot) continue;
      events.push(
        ...normalizeReaction(
          {
            messageId: message.id,
            channelId: message.channelId,
            reactor: toUserRef(user),
            messageAuthor: toUserRef(message.author),
            emoji: reaction.emoji.name ?? reaction.emoji.identifier,
            // O Discord não guarda quando a reação foi dada. Usar a data da
            // mensagem é a aproximação honesta: evita que reação em post de um
            // ano atrás entre no score30d como se fosse de hoje.
            occurredAt: message.createdAt,
            thread: threadRefOf(message),
          },
          ctx,
        ),
      );
      identities.push(identityOf(user));
    }
  }
}

async function backfillChannel(
  channel: TextChannel | AnyThreadChannel,
  guild: Guild,
  state: BackfillState,
  options: BackfillOptions,
): Promise<ChannelResult> {
  const ctx = baseContext(guild);
  const burst = new BurstTracker();
  const checkpoint: ChannelCheckpoint = state.channels[channel.id] ?? {
    oldestSeenId: null,
    done: false,
    messages: 0,
    updatedAt: new Date().toISOString(),
  };

  const result: ChannelResult = {
    channelId: channel.id,
    name: channel.name,
    messages: 0,
    events: 0,
    inserted: 0,
    skipped: 0,
    done: checkpoint.done,
  };

  if (checkpoint.done) {
    logger.info({ channel: channel.name }, 'canal já concluído no checkpoint — pulando');
    return result;
  }

  let before = checkpoint.oldestSeenId ?? undefined;

  while (result.messages < options.limit) {
    const pageSize = Math.min(PAGE_SIZE, options.limit - result.messages);
    const page = await withRetry(`messages.fetch#${channel.id}`, () =>
      channel.messages.fetch({ limit: pageSize, ...(before ? { before } : {}) }),
    );

    if (page.size === 0) {
      result.done = true;
      break;
    }

    // A página vem do mais novo para o mais antigo. A janela de burst de 60s só
    // faz sentido em ordem cronológica — sem isto ela é avaliada ao contrário.
    const ascending = [...page.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const events: MemberEvent[] = [];
    const identities: IdentityInput[] = [];

    for (const message of ascending) {
      if (!message.inGuild()) continue;
      if (message.system) continue;
      if (message.author.bot) continue;

      const raw = await toRawMessage(message);
      const lastCountedAt = burst.lastCountedAt(message.author.id, message.channelId);
      const messageEvents = normalizeMessage(raw, { ...ctx, lastCountedAt });

      if (messageEvents.length > 0) {
        events.push(...messageEvents);
        identities.push(identityOf(message.author));
        for (const user of message.mentions.users.values()) identities.push(identityOf(user));
        if (messageEvents.some((event) => event.eventType === 'message_sent')) {
          burst.commit(message.author.id, message.channelId, message.createdAt);
        }
      }

      if (options.reactions && message.reactions.cache.size > 0) {
        await collectReactionEvents(message, ctx, events, identities);
      }
    }

    await rememberIdentities(identities);
    const written = await insertEvents(events, env.DISCORD_GUILD_ID);

    result.messages += page.size;
    result.events += events.length;
    result.inserted += written.inserted;
    result.skipped += written.skipped;

    const oldest = ascending[0];
    before = oldest?.id;

    checkpoint.oldestSeenId = before ?? checkpoint.oldestSeenId;
    checkpoint.messages += page.size;
    checkpoint.updatedAt = new Date().toISOString();
    state.channels[channel.id] = checkpoint;
    saveState(state); // após cada página: Ctrl+C não custa a página seguinte

    logger.info(
      {
        channel: channel.name,
        pagina: page.size,
        mensagens: result.messages,
        eventos: result.events,
        inseridos: result.inserted,
      },
      'página processada',
    );

    if (page.size < pageSize) {
      result.done = true;
      break;
    }

    if (options.since && oldest && oldest.createdAt < options.since) {
      logger.info({ channel: channel.name, since: options.since }, 'alcançou --since');
      result.done = true;
      break;
    }
  }

  checkpoint.done = result.done;
  state.channels[channel.id] = checkpoint;
  saveState(state);

  return result;
}

async function threadsOf(channel: GuildBasedChannel): Promise<AnyThreadChannel[]> {
  if (!supportsThreads(channel) || !('threads' in channel)) return [];

  const found: AnyThreadChannel[] = [];

  const active = await withRetry('threads.fetchActive', () => channel.threads.fetchActive());
  found.push(...active.threads.values());

  let before: string | undefined;
  for (;;) {
    const archived = await withRetry('threads.fetchArchived', () =>
      channel.threads.fetchArchived({ limit: PAGE_SIZE, ...(before ? { before } : {}) }),
    );
    found.push(...archived.threads.values());
    if (!archived.hasMore || archived.threads.size === 0) break;
    before = archived.threads.last()?.id;
    if (!before) break;
  }

  return found;
}

export async function runBackfill(
  guild: Guild,
  options: BackfillOptions,
): Promise<BackfillSummary> {
  if (options.reset && existsSync(BACKFILL_STATE_PATH)) {
    saveState(structuredClone(EMPTY_STATE));
    logger.info('checkpoint zerado por --reset');
  }

  const state = loadState();
  const targets = await resolveTargets(guild, options);
  const results: ChannelResult[] = [];

  logger.info({ canais: targets.length, limite: options.limit }, 'backfill começando');

  for (const channel of targets) {
    if (supportsMessages(channel)) {
      results.push(await backfillChannel(channel, guild, state, options));
    }

    if (!options.threads) continue;

    const threads = await threadsOf(channel);
    if (threads.length > 0) {
      logger.info({ channel: channel.name, threads: threads.length }, 'threads encontradas');
    }

    for (const thread of threads) {
      // `thread_started` é retroativo: dá para reconstruir do próprio objeto.
      const ownerId = thread.ownerId;
      if (ownerId) {
        const owner = await withRetry('users.fetch', () => thread.client.users.fetch(ownerId));
        const events = normalizeThreadCreate(
          {
            threadId: thread.id,
            parentChannelId: thread.parentId ?? channel.id,
            owner: toUserRef(owner),
            occurredAt: thread.createdAt ?? new Date(),
          },
          baseContext(guild),
        );
        if (events.length > 0) {
          await rememberIdentities([identityOf(owner)]);
          await insertEvents(events, env.DISCORD_GUILD_ID);
        }
      }

      results.push(await backfillChannel(thread, guild, state, options));
    }
  }

  const totals = results.reduce(
    (acc, row) => ({
      messages: acc.messages + row.messages,
      events: acc.events + row.events,
      inserted: acc.inserted + row.inserted,
      skipped: acc.skipped + row.skipped,
    }),
    { messages: 0, events: 0, inserted: 0, skipped: 0 },
  );

  return { channels: results, totals };
}
