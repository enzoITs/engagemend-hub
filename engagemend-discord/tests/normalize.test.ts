import { describe, expect, it } from 'vitest';

import {
  BurstTracker,
  attachmentKind,
  isEmojiOnly,
  normalizeForumSolution,
  normalizeInviteUse,
  normalizeMessage,
  normalizeReaction,
  normalizeThreadCreate,
  normalizeVoiceSession,
} from '../src/collector/normalize.js';
import type { EventType, MemberEvent } from '../src/types/scoring.js';
import {
  ATTACHMENTS,
  CHANNELS,
  MESSAGES,
  T0,
  USERS,
  at,
  fakeHash,
  makeContext,
  makeForumSolution,
  makeInviteUse,
  makeMessage,
  makeReaction,
  makeThreadCreate,
  makeVoiceSession,
} from './fixtures/discord.js';

const typesOf = (events: readonly MemberEvent[]): EventType[] => events.map((e) => e.eventType);

/** Exige exatamente um evento do tipo e devolve; falha com contexto legível. */
function only(events: readonly MemberEvent[], type: EventType): MemberEvent {
  const found = events.filter((e) => e.eventType === type);
  const [first] = found;
  if (found.length !== 1 || !first) {
    throw new Error(
      `esperava exatamente 1 "${type}", vieram ${found.length}. Eventos: [${typesOf(events).join(', ')}]`,
    );
  }
  return first;
}

const has = (events: readonly MemberEvent[], type: EventType): boolean =>
  events.some((e) => e.eventType === type);

const LONG = 'a'.repeat(121);
const EXACTLY_120 = 'a'.repeat(120);
const EXACTLY_20 = 'a'.repeat(20);

// ── Portas de entrada ───────────────────────────────────────────────────────

describe('normalizeMessage — descartes', () => {
  it('ignora bot', () => {
    expect(normalizeMessage(makeMessage({ author: USERS.botty }), makeContext())).toEqual([]);
  });

  it('ignora canal marcado como ignored', () => {
    expect(
      normalizeMessage(makeMessage({ channelId: CHANNELS.ignored }), makeContext()),
    ).toEqual([]);
  });

  it('ignora thread cujo canal-pai é ignored', () => {
    const events = normalizeMessage(
      makeMessage({
        channelId: CHANNELS.thread,
        thread: { parentChannelId: CHANNELS.ignored, starterMessageId: MESSAGES.starter },
      }),
      makeContext(),
    );
    expect(events).toEqual([]);
  });

  it('descarta mensagem com menos de 20 chars e sem anexo', () => {
    expect(normalizeMessage(makeMessage({ content: 'valeu' }), makeContext())).toEqual([]);
  });

  it('mantém mensagem com exatamente 20 chars', () => {
    const events = normalizeMessage(makeMessage({ content: EXACTLY_20 }), makeContext());
    expect(typesOf(events)).toEqual(['message_sent']);
  });

  it('mantém mensagem curta quando tem anexo', () => {
    const events = normalizeMessage(
      makeMessage({ content: 'olha', attachments: [ATTACHMENTS.image] }),
      makeContext(),
    );
    expect(typesOf(events)).toEqual(['message_sent', 'media_posted']);
  });

  it('descarta mensagem só-emoji ainda que longa', () => {
    const events = normalizeMessage(makeMessage({ content: '🔥'.repeat(15) }), makeContext());
    expect(events).toEqual([]);
  });

  it('mantém mensagem só-emoji quando vem com clipe — a legenda é ruído, o clipe não', () => {
    const events = normalizeMessage(
      makeMessage({
        content: '🔥🔥',
        channelId: CHANNELS.gameplay,
        attachments: [ATTACHMENTS.video],
      }),
      makeContext(),
    );
    expect(typesOf(events)).toEqual(['message_sent', 'media_posted']);
    expect(only(events, 'media_posted').metadata['kind']).toBe('gameplay_clip');
  });
});

// ── Produção ────────────────────────────────────────────────────────────────

describe('normalizeMessage — eventos de produção são cumulativos', () => {
  it('mensagem normal gera só message_sent', () => {
    expect(typesOf(normalizeMessage(makeMessage(), makeContext()))).toEqual(['message_sent']);
  });

  it('120 chars ainda não é substancial; 121 é', () => {
    expect(typesOf(normalizeMessage(makeMessage({ content: EXACTLY_120 }), makeContext()))).toEqual(
      ['message_sent'],
    );
    expect(typesOf(normalizeMessage(makeMessage({ content: LONG }), makeContext()))).toEqual([
      'message_sent',
      'message_substantial',
    ]);
  });

  it('mensagem longa com clipe em gameplay soma os três', () => {
    const events = normalizeMessage(
      makeMessage({
        content: LONG,
        channelId: CHANNELS.gameplay,
        attachments: [ATTACHMENTS.video],
      }),
      makeContext(),
    );
    expect(typesOf(events)).toEqual(['message_sent', 'message_substantial', 'media_posted']);
  });

  it('vídeo fora de gameplay não vira gameplay_clip', () => {
    const events = normalizeMessage(
      makeMessage({ channelId: CHANNELS.general, attachments: [ATTACHMENTS.video] }),
      makeContext(),
    );
    expect(only(events, 'media_posted').metadata['kind']).toBe('video');
  });

  it('vídeo ganha de imagem quando os dois estão na mesma mensagem', () => {
    const events = normalizeMessage(
      makeMessage({
        channelId: CHANNELS.gameplay,
        attachments: [ATTACHMENTS.image, ATTACHMENTS.video],
      }),
      makeContext(),
    );
    const media = only(events, 'media_posted');
    expect(media.metadata['kind']).toBe('gameplay_clip');
    expect(media.metadata['attachmentCount']).toBe(2);
  });

  it('anexo que não é imagem nem vídeo não gera media_posted', () => {
    const events = normalizeMessage(
      makeMessage({ attachments: [ATTACHMENTS.pdf, ATTACHMENTS.audio] }),
      makeContext(),
    );
    expect(typesOf(events)).toEqual(['message_sent']);
  });

  it('um único media_posted por mensagem, com refId = message_id', () => {
    const events = normalizeMessage(
      makeMessage({ attachments: [ATTACHMENTS.image, ATTACHMENTS.image] }),
      makeContext(),
    );
    expect(only(events, 'media_posted').refId).toBe(MESSAGES.first);
  });
});

// ── Janela de burst ─────────────────────────────────────────────────────────

describe('normalizeMessage — agrupamento de 60s', () => {
  it('segunda mensagem dentro de 60s não conta como message_sent', () => {
    const events = normalizeMessage(
      makeMessage({ id: MESSAGES.second, content: LONG, occurredAt: at(30) }),
      makeContext({ lastCountedAt: T0 }),
    );
    expect(events).toEqual([]);
  });

  it('61s depois volta a contar', () => {
    const events = normalizeMessage(
      makeMessage({ id: MESSAGES.second, occurredAt: at(61) }),
      makeContext({ lastCountedAt: T0 }),
    );
    expect(typesOf(events)).toEqual(['message_sent']);
  });

  it('exatamente 60s já está fora da janela', () => {
    const events = normalizeMessage(
      makeMessage({ id: MESSAGES.second, occurredAt: at(60) }),
      makeContext({ lastCountedAt: T0 }),
    );
    expect(typesOf(events)).toEqual(['message_sent']);
  });

  it('burst suprime volume mas preserva clipe e resposta', () => {
    const events = normalizeMessage(
      makeMessage({
        id: MESSAGES.second,
        content: LONG,
        channelId: CHANNELS.gameplay,
        occurredAt: at(10),
        attachments: [ATTACHMENTS.video],
        repliedTo: { messageId: MESSAGES.first, author: USERS.bob },
      }),
      makeContext({ lastCountedAt: T0 }),
    );
    expect(typesOf(events)).toEqual([
      'media_posted',
      'reply_given',
      'reply_received',
    ]);
  });
});

// ── Reciprocidade e influência ──────────────────────────────────────────────

describe('normalizeMessage — respostas', () => {
  it('resposta gera reply_given para quem responde e reply_received para o alvo', () => {
    const events = normalizeMessage(
      makeMessage({
        id: MESSAGES.second,
        repliedTo: { messageId: MESSAGES.first, author: USERS.bob },
      }),
      makeContext(),
    );

    const given = only(events, 'reply_given');
    const received = only(events, 'reply_received');
    expect(given.memberHash).toBe(fakeHash(USERS.alice.id));
    expect(received.memberHash).toBe(fakeHash(USERS.bob.id));
    // refId da resposta, para que cada resposta recebida seja um evento distinto
    expect(received.refId).toBe(MESSAGES.second);
  });

  it('auto-resposta não conta', () => {
    const events = normalizeMessage(
      makeMessage({
        id: MESSAGES.second,
        repliedTo: { messageId: MESSAGES.first, author: USERS.alice },
      }),
      makeContext(),
    );
    expect(typesOf(events)).toEqual(['message_sent']);
  });

  it('responder a bot não gera reciprocidade', () => {
    const events = normalizeMessage(
      makeMessage({
        id: MESSAGES.second,
        repliedTo: { messageId: MESSAGES.first, author: USERS.botty },
      }),
      makeContext(),
    );
    expect(typesOf(events)).toEqual(['message_sent']);
  });
});

describe('normalizeMessage — menções', () => {
  it('gera mention_received para cada mencionado', () => {
    const events = normalizeMessage(
      makeMessage({ mentions: [USERS.bob, USERS.carol] }),
      makeContext(),
    );
    const mentions = events.filter((e) => e.eventType === 'mention_received');
    expect(mentions.map((e) => e.memberHash)).toEqual([
      fakeHash(USERS.bob.id),
      fakeHash(USERS.carol.id),
    ]);
  });

  it('não conta o próprio autor, bots, nem menção repetida', () => {
    const events = normalizeMessage(
      makeMessage({ mentions: [USERS.alice, USERS.botty, USERS.bob, USERS.bob] }),
      makeContext(),
    );
    expect(only(events, 'mention_received').memberHash).toBe(fakeHash(USERS.bob.id));
  });

  it('não conta a menção automática do autor respondido — senão influência dobra', () => {
    const events = normalizeMessage(
      makeMessage({
        id: MESSAGES.second,
        mentions: [USERS.bob],
        repliedTo: { messageId: MESSAGES.first, author: USERS.bob },
      }),
      makeContext(),
    );
    expect(has(events, 'mention_received')).toBe(false);
    expect(has(events, 'reply_received')).toBe(true);
  });
});

describe('normalizeMessage — boas-vindas a novato', () => {
  const joinedAtOf = (id: string): Date | null =>
    id === USERS.newbie.id ? new Date(T0.getTime() - 60 * 60 * 1000) : null;

  it('mencionar quem entrou nas últimas 24h credita newcomer_welcomed a quem menciona', () => {
    const events = normalizeMessage(
      makeMessage({ mentions: [USERS.newbie] }),
      makeContext({ joinedAtOf }),
    );
    const welcome = only(events, 'newcomer_welcomed');
    expect(welcome.memberHash).toBe(fakeHash(USERS.alice.id));
    expect(welcome.refId).toBe(`welcome:${MESSAGES.first}:${fakeHash(USERS.newbie.id)}`);
  });

  it('fora da janela de 24h não conta', () => {
    const events = normalizeMessage(
      makeMessage({ mentions: [USERS.newbie] }),
      makeContext({
        joinedAtOf: () => new Date(T0.getTime() - 48 * 60 * 60 * 1000),
      }),
    );
    expect(has(events, 'newcomer_welcomed')).toBe(false);
    expect(has(events, 'mention_received')).toBe(true);
  });

  it('dois novatos na mesma mensagem geram dois eventos com refId distinto', () => {
    const events = normalizeMessage(
      makeMessage({ mentions: [USERS.newbie, USERS.carol] }),
      makeContext({ joinedAtOf: () => new Date(T0.getTime() - 1000) }),
    );
    const welcomes = events.filter((e) => e.eventType === 'newcomer_welcomed');
    expect(welcomes).toHaveLength(2);
    expect(new Set(welcomes.map((e) => e.refId)).size).toBe(2);
  });

  it('a janela é medida contra a mensagem, não contra o relógio (vale no backfill)', () => {
    const historic = new Date('2025-01-10T00:00:00.000Z');
    const events = normalizeMessage(
      makeMessage({ occurredAt: historic, mentions: [USERS.newbie] }),
      makeContext({
        joinedAtOf: () => new Date(historic.getTime() - 2 * 60 * 60 * 1000),
      }),
    );
    expect(has(events, 'newcomer_welcomed')).toBe(true);
  });
});

describe('normalizeMessage — threads', () => {
  const inThread = {
    channelId: CHANNELS.thread,
    thread: { parentChannelId: CHANNELS.general, starterMessageId: MESSAGES.starter },
  };

  it('mensagem dentro de thread gera thread_replied', () => {
    const events = normalizeMessage(makeMessage({ id: MESSAGES.second, ...inThread }), makeContext());
    expect(has(events, 'thread_replied')).toBe(true);
  });

  it('a mensagem que originou a thread não é resposta de thread', () => {
    const events = normalizeMessage(
      makeMessage({ id: MESSAGES.starter, ...inThread }),
      makeContext(),
    );
    expect(has(events, 'thread_replied')).toBe(false);
  });

  it('contextId é a thread e metadata guarda o canal-pai', () => {
    const events = normalizeMessage(makeMessage({ id: MESSAGES.second, ...inThread }), makeContext());
    const replied = only(events, 'thread_replied');
    expect(replied.contextId).toBe(CHANNELS.thread);
    expect(replied.metadata['parentChannelId']).toBe(CHANNELS.general);
  });
});

// ── Privacidade (§3) ────────────────────────────────────────────────────────

describe('privacidade', () => {
  it('nenhum evento carrega o texto da mensagem', () => {
    const secret = 'SEGREDO-QUE-NAO-PODE-IR-PRO-BANCO';
    const events = normalizeMessage(
      makeMessage({
        content: `${secret} ${LONG}`,
        mentions: [USERS.bob],
        repliedTo: { messageId: MESSAGES.first, author: USERS.carol },
        attachments: [ATTACHMENTS.image],
      }),
      makeContext(),
    );

    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('guarda o comprimento, que é o atributo derivado que o §3 permite', () => {
    const events = normalizeMessage(makeMessage({ content: EXACTLY_20 }), makeContext());
    expect(only(events, 'message_sent').metadata['contentLength']).toBe(20);
  });

  it('nenhum evento carrega discord_id em claro', () => {
    const events = normalizeMessage(
      makeMessage({ mentions: [USERS.bob] }),
      makeContext({ hashMember: (id) => `sha:${id.length}` }),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(USERS.alice.id);
    expect(serialized).not.toContain(USERS.bob.id);
  });
});

// ── Reações ─────────────────────────────────────────────────────────────────

describe('normalizeReaction', () => {
  it('gera reaction_given para quem reage e reaction_received para o autor', () => {
    const events = normalizeReaction(makeReaction(), makeContext());
    expect(typesOf(events)).toEqual(['reaction_given', 'reaction_received']);
    expect(only(events, 'reaction_given').memberHash).toBe(fakeHash(USERS.bob.id));
    expect(only(events, 'reaction_received').memberHash).toBe(fakeHash(USERS.alice.id));
  });

  it('reaction_given colapsa emojis diferentes do mesmo reator (anti-spam)', () => {
    const a = normalizeReaction(makeReaction({ emoji: 'fire' }), makeContext());
    const b = normalizeReaction(makeReaction({ emoji: 'heart' }), makeContext());
    expect(only(a, 'reaction_given').refId).toBe(only(b, 'reaction_given').refId);
  });

  it('reaction_received é distinto por reator — 50 pessoas viram 50 eventos', () => {
    const fromBob = only(normalizeReaction(makeReaction(), makeContext()), 'reaction_received');
    const fromCarol = only(
      normalizeReaction(makeReaction({ reactor: USERS.carol }), makeContext()),
      'reaction_received',
    );

    expect(fromBob.refId).toBe(`reaction:${MESSAGES.first}:${fakeHash(USERS.bob.id)}`);
    expect(fromCarol.refId).toBe(`reaction:${MESSAGES.first}:${fakeHash(USERS.carol.id)}`);
    expect(fromBob.refId).not.toBe(fromCarol.refId);
  });

  it('reaction_received não depende do emoji — mesmo reator, mesmo evento', () => {
    const a = normalizeReaction(makeReaction({ emoji: 'fire' }), makeContext());
    const b = normalizeReaction(makeReaction({ emoji: 'heart' }), makeContext());
    expect(only(a, 'reaction_received').refId).toBe(only(b, 'reaction_received').refId);
  });

  it('reação na própria mensagem não conta', () => {
    expect(normalizeReaction(makeReaction({ reactor: USERS.alice }), makeContext())).toEqual([]);
  });

  it('bot reagindo não conta', () => {
    expect(normalizeReaction(makeReaction({ reactor: USERS.botty }), makeContext())).toEqual([]);
  });

  it('reagir a mensagem de bot conta para quem reage, não para o bot', () => {
    const events = normalizeReaction(makeReaction({ messageAuthor: USERS.botty }), makeContext());
    expect(typesOf(events)).toEqual(['reaction_given']);
  });

  it('canal ignored não gera reação', () => {
    expect(
      normalizeReaction(makeReaction({ channelId: CHANNELS.ignored }), makeContext()),
    ).toEqual([]);
  });
});

// ── Threads, fórum ──────────────────────────────────────────────────────────

describe('normalizeThreadCreate / normalizeForumSolution', () => {
  it('thread_started credita o dono, com refId = threadId', () => {
    const events = normalizeThreadCreate(makeThreadCreate(), makeContext());
    const started = only(events, 'thread_started');
    expect(started.memberHash).toBe(fakeHash(USERS.alice.id));
    expect(started.refId).toBe(CHANNELS.thread);
    expect(started.contextId).toBe(CHANNELS.general);
  });

  it('thread criada por bot ou em canal ignored não conta', () => {
    expect(normalizeThreadCreate(makeThreadCreate({ owner: USERS.botty }), makeContext())).toEqual(
      [],
    );
    expect(
      normalizeThreadCreate(
        makeThreadCreate({ parentChannelId: CHANNELS.ignored }),
        makeContext(),
      ),
    ).toEqual([]);
  });

  it('forum_solution credita quem escreveu a solução', () => {
    const events = normalizeForumSolution(makeForumSolution(), makeContext());
    const solution = only(events, 'forum_solution');
    expect(solution.memberHash).toBe(fakeHash(USERS.bob.id));
    expect(solution.refId).toBe(MESSAGES.second);
    expect(solution.contextId).toBe(CHANNELS.thread);
  });
});

// ── Voz e convites (não retroativos) ────────────────────────────────────────

describe('normalizeVoiceSession', () => {
  it('25 minutos geram 2 blocos fechados', () => {
    const events = normalizeVoiceSession(makeVoiceSession(), makeContext());
    expect(events).toHaveLength(2);
    expect(typesOf(events)).toEqual(['voice_minutes', 'voice_minutes']);
  });

  it('6 minutos não geram bloco nenhum', () => {
    const events = normalizeVoiceSession(
      makeVoiceSession({ leftAt: at(6 * 60) }),
      makeContext(),
    );
    expect(events).toEqual([]);
  });

  it('exatamente 10 minutos geram 1', () => {
    const events = normalizeVoiceSession(
      makeVoiceSession({ leftAt: at(10 * 60) }),
      makeContext(),
    );
    expect(events).toHaveLength(1);
  });

  it('refId segue voice:{channelId}:{bucket10min} e não colide entre blocos', () => {
    const events = normalizeVoiceSession(makeVoiceSession(), makeContext());
    const refIds = events.map((e) => e.refId);
    expect(new Set(refIds).size).toBe(2);
    for (const refId of refIds) {
      expect(refId).toMatch(new RegExp(`^voice:${CHANNELS.general}:\\d+$`));
    }
  });

  it('é creditado no fim de cada bloco', () => {
    const events = normalizeVoiceSession(makeVoiceSession(), makeContext());
    expect(events.map((e) => e.occurredAt.toISOString())).toEqual([
      at(10 * 60).toISOString(),
      at(20 * 60).toISOString(),
    ]);
  });

  it('reprocessar a mesma sessão produz os mesmos refIds (idempotente sob o dedupe_key)', () => {
    const first = normalizeVoiceSession(makeVoiceSession(), makeContext());
    const second = normalizeVoiceSession(makeVoiceSession(), makeContext());
    expect(first.map((e) => e.refId)).toEqual(second.map((e) => e.refId));
  });

  it('bot e canal ignored não geram voz', () => {
    expect(normalizeVoiceSession(makeVoiceSession({ member: USERS.botty }), makeContext())).toEqual(
      [],
    );
    expect(
      normalizeVoiceSession(makeVoiceSession({ channelId: CHANNELS.ignored }), makeContext()),
    ).toEqual([]);
  });
});

describe('normalizeInviteUse', () => {
  it('credita quem convidou, com refId invite:{code}:{novoMemberHash}', () => {
    const events = normalizeInviteUse(makeInviteUse(), makeContext());
    const invite = only(events, 'invite_used');
    expect(invite.memberHash).toBe(fakeHash(USERS.alice.id));
    expect(invite.refId).toBe(`invite:aBcD1234:${fakeHash(USERS.newbie.id)}`);
  });

  it('mesmo convite usado por duas pessoas gera dois eventos distintos', () => {
    const a = only(normalizeInviteUse(makeInviteUse(), makeContext()), 'invite_used');
    const b = only(
      normalizeInviteUse(makeInviteUse({ newMember: USERS.carol }), makeContext()),
      'invite_used',
    );
    expect(a.refId).not.toBe(b.refId);
  });

  it('convite sem inviter conhecido, de bot, ou auto-convite não contam', () => {
    expect(normalizeInviteUse(makeInviteUse({ inviter: null }), makeContext())).toEqual([]);
    expect(normalizeInviteUse(makeInviteUse({ inviter: USERS.botty }), makeContext())).toEqual([]);
    expect(
      normalizeInviteUse(
        makeInviteUse({ inviter: USERS.newbie, newMember: USERS.newbie }),
        makeContext(),
      ),
    ).toEqual([]);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

describe('isEmojiOnly', () => {
  it.each([
    ['👍'],
    ['🔥🔥🔥'],
    ['👍 🎉  🚀'],
    ['<:pepe:300000000000000001>'],
    ['<a:dance:300000000000000002> 🔥'],
    ['1️⃣'],
    ['👨‍👩‍👧'],
    ['🇧🇷'],
    ['👍🏽'],
  ])('reconhece %s como só-emoji', (text) => {
    expect(isEmojiOnly(text)).toBe(true);
  });

  it.each([['👍 boa'], ['ok'], ['1'], ['123'], ['#1'], ['nice 🔥']])(
    'não trata %s como só-emoji',
    (text) => {
      expect(isEmojiOnly(text)).toBe(false);
    },
  );

  it('string vazia não é só-emoji', () => {
    expect(isEmojiOnly('   ')).toBe(false);
  });
});

describe('attachmentKind', () => {
  it('usa o content-type quando existe', () => {
    expect(attachmentKind(ATTACHMENTS.image)).toBe('image');
    expect(attachmentKind(ATTACHMENTS.video)).toBe('video');
    expect(attachmentKind(ATTACHMENTS.audio)).toBe('audio');
    expect(attachmentKind(ATTACHMENTS.pdf)).toBe('other');
  });

  it('cai para a extensão, sem depender de caixa', () => {
    expect(attachmentKind(ATTACHMENTS.videoByExtension)).toBe('video');
    expect(attachmentKind({ contentType: null, name: 'FOTO.JPEG' })).toBe('image');
  });

  it('sem content-type e sem extensão conhecida é other', () => {
    expect(attachmentKind({ contentType: null, name: 'arquivo.xyz' })).toBe('other');
    expect(attachmentKind({})).toBe('other');
  });
});

describe('BurstTracker', () => {
  it('começa vazio e devolve o instante comitado', () => {
    const tracker = new BurstTracker();
    expect(tracker.lastCountedAt(USERS.alice.id, CHANNELS.general)).toBeNull();

    tracker.commit(USERS.alice.id, CHANNELS.general, T0);
    expect(tracker.lastCountedAt(USERS.alice.id, CHANNELS.general)?.toISOString()).toBe(
      T0.toISOString(),
    );
  });

  it('separa por autor e por canal', () => {
    const tracker = new BurstTracker();
    tracker.commit(USERS.alice.id, CHANNELS.general, T0);
    expect(tracker.lastCountedAt(USERS.alice.id, CHANNELS.gameplay)).toBeNull();
    expect(tracker.lastCountedAt(USERS.bob.id, CHANNELS.general)).toBeNull();
  });

  it('prune descarta entradas anteriores ao corte', () => {
    const tracker = new BurstTracker();
    tracker.commit(USERS.alice.id, CHANNELS.general, T0);
    tracker.commit(USERS.bob.id, CHANNELS.general, at(600));

    tracker.prune(at(300));
    expect(tracker.size).toBe(1);
    expect(tracker.lastCountedAt(USERS.alice.id, CHANNELS.general)).toBeNull();
  });

  it('alimenta o ciclo real: comita só o que virou message_sent', () => {
    const tracker = new BurstTracker();
    const ctxNow = () =>
      makeContext({ lastCountedAt: tracker.lastCountedAt(USERS.alice.id, CHANNELS.general) });

    const first = normalizeMessage(makeMessage({ occurredAt: T0 }), ctxNow());
    if (has(first, 'message_sent')) tracker.commit(USERS.alice.id, CHANNELS.general, T0);

    const second = normalizeMessage(
      makeMessage({ id: MESSAGES.second, occurredAt: at(20) }),
      ctxNow(),
    );
    const third = normalizeMessage(
      makeMessage({ id: MESSAGES.third, occurredAt: at(90) }),
      ctxNow(),
    );

    expect(typesOf(first)).toEqual(['message_sent']);
    expect(second).toEqual([]);
    // a segunda não comitou, então a janela ainda parte de T0 — 90s depois conta
    expect(typesOf(third)).toEqual(['message_sent']);
  });
});
