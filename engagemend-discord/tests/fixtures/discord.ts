/**
 * Fixtures de payload do Discord.
 *
 * Ids são snowflakes plausíveis (18 dígitos) porque `CUSTOM_EMOJI_RE` valida
 * o formato do id em emoji customizado — id de brinquedo quebraria o teste
 * pelo motivo errado.
 */

import type { ChannelCategory } from '../../src/config/channels.js';
import type {
  NormalizeContext,
  RawForumSolution,
  RawInviteUse,
  RawMessage,
  RawReaction,
  RawThreadCreate,
  RawUserRef,
  RawVoiceSession,
} from '../../src/collector/normalize.js';

export const CHANNELS = {
  general: '100000000000000001',
  gameplay: '100000000000000002',
  support: '100000000000000003',
  offtopic: '100000000000000004',
  ignored: '100000000000000009',
  thread: '100000000000000011',
} as const;

export const CATEGORY_BY_CHANNEL: Readonly<Record<string, ChannelCategory>> = {
  [CHANNELS.general]: 'general',
  [CHANNELS.gameplay]: 'gameplay',
  [CHANNELS.support]: 'support',
  [CHANNELS.offtopic]: 'offtopic',
  [CHANNELS.ignored]: 'ignored',
};

export const USERS = {
  alice: { id: '200000000000000001', isBot: false },
  bob: { id: '200000000000000002', isBot: false },
  carol: { id: '200000000000000003', isBot: false },
  newbie: { id: '200000000000000004', isBot: false },
  botty: { id: '200000000000000099', isBot: true },
} as const satisfies Record<string, RawUserRef>;

export const MESSAGES = {
  first: '300000000000000001',
  second: '300000000000000002',
  third: '300000000000000003',
  starter: '300000000000000010',
} as const;

/** Hash falso: legível no output do teste e injetivo, que é tudo o que importa aqui. */
export const fakeHash = (discordId: string): string => `h:${discordId}`;

/** Âncora temporal fixa. Nenhum teste depende do relógio. */
export const T0 = new Date('2026-03-01T12:00:00.000Z');

export function at(offsetSeconds: number): Date {
  return new Date(T0.getTime() + offsetSeconds * 1000);
}

export function makeContext(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    hashMember: fakeHash,
    categoryOf: (channelId) => CATEGORY_BY_CHANNEL[channelId] ?? 'general',
    ...overrides,
  };
}

/** Conteúdo default: 40 chars, passa o piso de 20 e fica abaixo dos 120. */
const DEFAULT_CONTENT = 'mensagem de tamanho normal para o teste.';

export function makeMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: MESSAGES.first,
    channelId: CHANNELS.general,
    author: USERS.alice,
    content: DEFAULT_CONTENT,
    occurredAt: T0,
    ...overrides,
  };
}

export function makeReaction(overrides: Partial<RawReaction> = {}): RawReaction {
  return {
    messageId: MESSAGES.first,
    channelId: CHANNELS.general,
    reactor: USERS.bob,
    messageAuthor: USERS.alice,
    emoji: 'thumbsup',
    occurredAt: T0,
    ...overrides,
  };
}

export function makeThreadCreate(overrides: Partial<RawThreadCreate> = {}): RawThreadCreate {
  return {
    threadId: CHANNELS.thread,
    parentChannelId: CHANNELS.general,
    owner: USERS.alice,
    occurredAt: T0,
    ...overrides,
  };
}

export function makeForumSolution(overrides: Partial<RawForumSolution> = {}): RawForumSolution {
  return {
    threadId: CHANNELS.thread,
    parentChannelId: CHANNELS.support,
    solutionMessageId: MESSAGES.second,
    author: USERS.bob,
    occurredAt: T0,
    ...overrides,
  };
}

export function makeVoiceSession(overrides: Partial<RawVoiceSession> = {}): RawVoiceSession {
  return {
    member: USERS.alice,
    channelId: CHANNELS.general,
    joinedAt: T0,
    leftAt: at(25 * 60),
    ...overrides,
  };
}

export function makeInviteUse(overrides: Partial<RawInviteUse> = {}): RawInviteUse {
  return {
    inviteCode: 'aBcD1234',
    inviter: USERS.alice,
    newMember: USERS.newbie,
    occurredAt: T0,
    ...overrides,
  };
}

/** Anexos prontos, para não repetir content-type em todo teste. */
export const ATTACHMENTS = {
  image: { contentType: 'image/png', name: 'print.png' },
  video: { contentType: 'video/mp4', name: 'clip.mp4' },
  videoByExtension: { contentType: null, name: 'clip.MOV' },
  audio: { contentType: 'audio/mpeg', name: 'audio.mp3' },
  pdf: { contentType: 'application/pdf', name: 'planilha.pdf' },
} as const;
