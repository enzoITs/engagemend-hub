import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type ThreadChannel,
  type User,
  type VoiceState,
} from 'discord.js';

import { resolveChannelCategory } from '../config/channels.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { insertEvents } from '../store/events.js';
import { hashMember, rememberIdentities, rememberIdentity } from '../store/identity.js';
import type { MemberEvent } from '../types/scoring.js';
import { InviteTracker } from './invite-tracker.js';
import {
  BurstTracker,
  normalizeMessage,
  normalizeReaction,
  normalizeThreadCreate,
  normalizeVoiceSession,
  normalizeInviteUse,
  type NormalizeContext,
  type RawMessage,
  type RawThreadRef,
  type RawUserRef,
} from './normalize.js';

/**
 * Coletor em tempo real.
 *
 * Este arquivo NÃO calcula nível, score ou peso (§1.2). Ele só traduz evento do
 * gateway em `MemberEvent` (via `normalize`, que é puro) e grava.
 *
 * O bot não tem nenhuma permissão de escrita no Discord e não envia nada para
 * ninguém — nem mensagem, nem DM, nem reação (§0, §10).
 */

const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers, // privilegiada
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates, // privilegiada
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.MessageContent, // privilegiada
];

/** Sem os partials, reação em mensagem antiga (fora do cache) chega vazia. */
const PARTIALS = [
  Partials.Message,
  Partials.Channel,
  Partials.Reaction,
  Partials.User,
  Partials.GuildMember,
];

const BURST_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const BURST_PRUNE_HORIZON_MS = 10 * 60 * 1000;

interface OpenVoiceSession {
  channelId: string;
  joinedAt: Date;
}

export interface ChannelRow {
  id: string;
  name: string;
  type: string;
  parent: string | null;
}

export function createClient(): Client {
  return new Client({ intents: INTENTS, partials: PARTIALS });
}

export function toUserRef(user: { id: string; bot: boolean }): RawUserRef {
  return { id: user.id, isBot: user.bot };
}

export function threadRefOf(message: Message<true>): RawThreadRef | null {
  const channel = message.channel;
  if (!channel.isThread()) return null;
  const thread: ThreadChannel = channel;
  return {
    parentChannelId: thread.parentId ?? thread.id,
    // Numa thread aberta a partir de mensagem (e em post de fórum), o id da
    // thread é o id da mensagem que a originou.
    starterMessageId: thread.id,
  };
}

/** Usado pelo bot e pelo backfill — é o que garante que os dois vejam a mesma mensagem. */
export async function toRawMessage(message: Message<true>): Promise<RawMessage> {
  const attachments = message.attachments.map((attachment) => ({
    contentType: attachment.contentType,
    name: attachment.name,
  }));

  const mentions = message.mentions.users.map((user) => toUserRef(user));

  let repliedTo: RawMessage['repliedTo'] = null;
  const referenceId = message.reference?.messageId;
  if (referenceId) {
    // `repliedUser` só vem preenchido quando a resposta pinga. Quando o autor
    // desliga o ping, só o fetch resolve.
    const replied = message.mentions.repliedUser ?? (await fetchReferenceAuthor(message));
    if (replied) repliedTo = { messageId: referenceId, author: toUserRef(replied) };
  }

  return {
    id: message.id,
    channelId: message.channelId,
    author: toUserRef(message.author),
    content: message.content,
    occurredAt: message.createdAt,
    attachments,
    mentions,
    repliedTo,
    thread: threadRefOf(message),
  };
}

async function fetchReferenceAuthor(message: Message<true>): Promise<User | null> {
  try {
    const referenced = await message.fetchReference();
    return referenced.author;
  } catch {
    // Mensagem original apagada ou inacessível: a resposta perde a reciprocidade,
    // mas o resto da mensagem continua contando.
    return null;
  }
}

export class Collector {
  readonly #client: Client;
  readonly #burst = new BurstTracker();
  readonly #invites = new InviteTracker();
  readonly #voice = new Map<string, OpenVoiceSession>();
  #pruneTimer: NodeJS.Timeout | null = null;
  #guild: Guild | null = null;

  constructor(client: Client = createClient()) {
    this.#client = client;
  }

  get client(): Client {
    return this.#client;
  }

  get guild(): Guild | null {
    return this.#guild;
  }

  /** Contexto de normalização. `joinedAtOf` lê o cache de membros do gateway. */
  #context(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
    return {
      hashMember: (discordId) => hashMember('discord', discordId),
      categoryOf: (channelId) => resolveChannelCategory(channelId),
      joinedAtOf: (discordId) => this.#guild?.members.cache.get(discordId)?.joinedAt ?? null,
      ...overrides,
    };
  }

  async #persist(events: readonly MemberEvent[], context: string): Promise<number> {
    if (events.length === 0) return 0;
    const { inserted, skipped } = await insertEvents(events, env.DISCORD_GUILD_ID);
    logger.info({ context, inserted, skipped }, 'eventos gravados');
    return inserted;
  }

  async login(): Promise<void> {
    this.#registerHandlers();
    await this.#client.login(env.DISCORD_TOKEN);
  }

  async #onReady(client: Client<true>): Promise<void> {
    logger.info({ tag: client.user.tag, id: client.user.id }, 'conectado ao gateway');

    const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
    this.#guild = guild;

    // Popula o cache de membros — `joinedAtOf` depende dele para newcomer_welcomed.
    try {
      const members = await guild.members.fetch();
      logger.info({ guild: guild.name, members: members.size }, 'guild carregado');
    } catch (error) {
      logger.warn({ err: error }, 'não consegui listar membros — GUILD_MEMBERS está habilitada?');
    }

    await this.#invites.prime(guild);

    this.#pruneTimer = setInterval(() => {
      this.#burst.prune(new Date(Date.now() - BURST_PRUNE_HORIZON_MS));
    }, BURST_PRUNE_INTERVAL_MS);
    this.#pruneTimer.unref();
  }

  #registerHandlers(): void {
    const client = this.#client;

    client.once(Events.ClientReady, (ready) => {
      void this.#guard('ready', () => this.#onReady(ready));
    });

    client.on(Events.MessageCreate, (message) => {
      void this.#guard('messageCreate', () => this.#onMessage(message));
    });

    client.on(Events.MessageReactionAdd, (reaction, user) => {
      void this.#guard('messageReactionAdd', () => this.#onReaction(reaction, user));
    });

    client.on(Events.ThreadCreate, (thread) => {
      void this.#guard('threadCreate', () => this.#onThreadCreate(thread));
    });

    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      void this.#guard('voiceStateUpdate', () => this.#onVoiceState(oldState, newState));
    });

    client.on(Events.GuildMemberAdd, (member) => {
      void this.#guard('guildMemberAdd', async () => {
        await rememberIdentity({
          discordId: member.id,
          username: member.user.username,
          displayName: member.displayName,
          isBot: member.user.bot,
          joinedAt: member.joinedAt,
        });
        await this.#onMemberAdd(member.guild, toUserRef(member.user));
      });
    });

    client.on(Events.InviteCreate, (invite) => this.#invites.onCreate(invite));
    client.on(Events.InviteDelete, (invite) => this.#invites.onDelete(invite));

    client.on(Events.Error, (error) => logger.error({ err: error }, 'erro do cliente discord.js'));
    client.on(Events.Warn, (message) => logger.warn({ discord: message }, 'aviso do discord.js'));
  }

  /** Um handler que estoura não pode derrubar o coletor — dado perdido não volta. */
  async #guard(context: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      logger.error({ err: error, context }, 'handler falhou');
    }
  }

  async #onMessage(message: Message): Promise<void> {
    if (!message.inGuild()) return;
    if (message.guildId !== env.DISCORD_GUILD_ID) return;
    if (message.author.bot) return;
    if (message.system) return;

    const raw = await toRawMessage(message);
    const lastCountedAt = this.#burst.lastCountedAt(message.author.id, message.channelId);
    const events = normalizeMessage(raw, this.#context({ lastCountedAt }));
    if (events.length === 0) return;

    await rememberIdentities([
      {
        discordId: message.author.id,
        username: message.author.username,
        displayName: message.member?.displayName ?? message.author.displayName,
        isBot: false,
      },
      ...message.mentions.users.map((user) => ({
        discordId: user.id,
        username: user.username,
        displayName: user.displayName,
        isBot: user.bot,
      })),
      ...(raw.repliedTo
        ? [
            {
              discordId: raw.repliedTo.author.id,
              username: raw.repliedTo.author.id,
              isBot: raw.repliedTo.author.isBot,
            },
          ]
        : []),
    ]);

    await this.#persist(events, 'messageCreate');

    // A janela de 60s só avança quando a mensagem realmente contou como volume.
    if (events.some((event) => event.eventType === 'message_sent')) {
      this.#burst.commit(message.author.id, message.channelId, message.createdAt);
    }
  }

  async #onReaction(
    rawReaction: MessageReaction | PartialMessageReaction,
    rawUser: User | PartialUser,
  ): Promise<void> {
    const reaction = rawReaction.partial ? await rawReaction.fetch() : rawReaction;
    const user = rawUser.partial ? await rawUser.fetch() : rawUser;
    if (user.bot) return;

    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;
    if (!message.inGuild()) return;
    if (message.guildId !== env.DISCORD_GUILD_ID) return;

    const events = normalizeReaction(
      {
        messageId: message.id,
        channelId: message.channelId,
        reactor: toUserRef(user),
        messageAuthor: toUserRef(message.author),
        emoji: reaction.emoji.name ?? reaction.emoji.identifier,
        occurredAt: new Date(),
        thread: threadRefOf(message),
      },
      this.#context(),
    );
    if (events.length === 0) return;

    await rememberIdentities([
      { discordId: user.id, username: user.username, displayName: user.displayName, isBot: false },
      {
        discordId: message.author.id,
        username: message.author.username,
        displayName: message.author.displayName,
        isBot: message.author.bot,
      },
    ]);

    await this.#persist(events, 'messageReactionAdd');
  }

  async #onThreadCreate(thread: ThreadChannel): Promise<void> {
    if (thread.guildId !== env.DISCORD_GUILD_ID) return;
    const ownerId = thread.ownerId;
    if (!ownerId) return;

    const owner = await thread.client.users.fetch(ownerId);
    if (owner.bot) return;

    const events = normalizeThreadCreate(
      {
        threadId: thread.id,
        parentChannelId: thread.parentId ?? thread.id,
        owner: toUserRef(owner),
        occurredAt: thread.createdAt ?? new Date(),
      },
      this.#context(),
    );

    await rememberIdentity({
      discordId: owner.id,
      username: owner.username,
      displayName: owner.displayName,
      isBot: false,
    });
    await this.#persist(events, 'threadCreate');
  }

  /**
   * Voz é o dado mais perecível do sistema: o Discord não guarda log nenhum de
   * `voiceStateUpdate`. Cada minuto de bot fora do ar é minuto perdido (§9).
   */
  async #onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (newState.guild.id !== env.DISCORD_GUILD_ID) return;
    const memberId = newState.id;
    const user = newState.member?.user ?? oldState.member?.user;
    if (user?.bot) return;

    const left = oldState.channelId && oldState.channelId !== newState.channelId;
    const joined = newState.channelId && newState.channelId !== oldState.channelId;

    if (left) await this.#closeVoiceSession(memberId, user ?? null, new Date());

    if (joined && newState.channelId) {
      this.#voice.set(memberId, { channelId: newState.channelId, joinedAt: new Date() });
    }
  }

  async #closeVoiceSession(
    memberId: string,
    user: User | null,
    leftAt: Date,
  ): Promise<void> {
    const open = this.#voice.get(memberId);
    if (!open) return;
    this.#voice.delete(memberId);

    const events = normalizeVoiceSession(
      {
        member: { id: memberId, isBot: user?.bot ?? false },
        channelId: open.channelId,
        joinedAt: open.joinedAt,
        leftAt,
      },
      this.#context(),
    );
    if (events.length === 0) return;

    if (user) {
      await rememberIdentity({
        discordId: user.id,
        username: user.username,
        displayName: user.displayName,
        isBot: user.bot,
      });
    }
    await this.#persist(events, 'voiceSession');
  }

  async #onMemberAdd(guild: Guild, newMember: RawUserRef): Promise<void> {
    const used = await this.#invites.resolveUsedInvite(guild);
    if (!used?.inviterId) return;

    const inviter = await guild.client.users.fetch(used.inviterId);
    const events = normalizeInviteUse(
      {
        inviteCode: used.code,
        inviter: toUserRef(inviter),
        newMember,
        occurredAt: new Date(),
      },
      this.#context(),
    );

    await rememberIdentity({
      discordId: inviter.id,
      username: inviter.username,
      displayName: inviter.displayName,
      isBot: inviter.bot,
    });
    await this.#persist(events, 'guildMemberAdd');
  }

  /** Fecha o que estiver aberto e desconecta. */
  async shutdown(): Promise<void> {
    if (this.#pruneTimer) clearInterval(this.#pruneTimer);

    const now = new Date();
    const open = [...this.#voice.keys()];
    for (const memberId of open) {
      const user = this.#guild?.members.cache.get(memberId)?.user ?? null;
      await this.#guard('shutdownVoice', () => this.#closeVoiceSession(memberId, user, now));
    }
    if (open.length > 0) logger.info({ sessions: open.length }, 'sessões de voz fechadas');

    await this.#client.destroy();
  }
}

/** Lista os canais do guild para o mapeamento do §7. */
export async function listGuildChannels(guild: Guild): Promise<ChannelRow[]> {
  const channels = await guild.channels.fetch();
  const rows: ChannelRow[] = [];

  for (const channel of channels.values()) {
    if (!channel) continue;
    rows.push({
      id: channel.id,
      name: channel.name,
      type: ChannelType[channel.type] ?? String(channel.type),
      parent: channel.parent?.name ?? null,
    });
  }

  return rows.sort(
    (a, b) => (a.parent ?? '').localeCompare(b.parent ?? '') || a.name.localeCompare(b.name),
  );
}
