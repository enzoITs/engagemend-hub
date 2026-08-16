import { Command } from 'commander';

import { levelName } from '../classifier/level.js';
import { resolveChannelName } from '../config/channels.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma, prisma } from '../lib/prisma.js';
import type { EngagementLevel, EventType } from '../types/scoring.js';

/**
 * `pnpm ver`            — cada pessoa, o que ela fez e quando
 * `pnpm ver --eventos`  — os últimos 30 acontecimentos em texto corrido
 *
 * Feito para quem não programa ler. Nada de hash, id de canal, id de mensagem
 * ou timestamp ISO — nome de gente e data em dia/mês/ano.
 *
 * Este comando mostra nome real de propósito, ao contrário do
 * `pnpm report --export=csv`, que é cego porque a revisão da Frente D precisa ser.
 */

const RECENT_EVENTS = 30;

/** Saída humana em horário de Brasília — a data tem que bater com a memória de quem lê. */
const TIMEZONE = 'America/Sao_Paulo';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/**
 * Tradução dos tipos de evento.
 *
 * As três últimas não estavam na lista pedida — escolhi o texto e vale conferir:
 * `thread_started`, `thread_replied` e `forum_solution`.
 */
const LABELS: Readonly<Record<EventType, string>> = {
  message_sent: 'mandou mensagem',
  message_substantial: 'mandou mensagem longa',
  media_posted: 'postou imagem ou vídeo',
  reply_given: 'respondeu alguém',
  reply_received: 'foi respondido',
  reaction_given: 'reagiu',
  reaction_received: 'recebeu reação',
  mention_received: 'foi mencionado',
  newcomer_welcomed: 'deu boas-vindas',
  voice_minutes: 'ficou em call',
  invite_used: 'trouxe alguém novo',
  thread_started: 'começou uma conversa',
  thread_replied: 'respondeu numa conversa',
  forum_solution: 'resolveu uma dúvida',
  comment_sent: 'comentou no YouTube',
  comment_substantial: 'comentou algo relevante no YouTube',
  comment_reply_received: 'teve comentário respondido no YouTube',
};

function label(eventType: string): string {
  return LABELS[eventType as EventType] ?? eventType;
}

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count === 1 ? singular : many}`;
}

async function nameByHash(): Promise<Map<string, string>> {
  const rows = await prisma.memberIdentity.findMany({
    select: { memberHash: true, username: true, displayName: true },
  });
  return new Map(rows.map((row) => [row.memberHash, row.displayName ?? row.username]));
}

const program = new Command()
  .name('ver')
  .description('Mostra o conteúdo do banco em português')
  .option('--eventos', 'lista os últimos acontecimentos em vez do resumo por pessoa', false)
  .parse();

const options = program.opts<{ eventos: boolean }>();

const out = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

try {
  const names = await nameByHash();
  const unknown = (hash: string) => names.get(hash) ?? 'alguém que saiu do servidor';

  if (options.eventos) {
    const events = await prisma.memberEvent.findMany({
      orderBy: { occurredAt: 'desc' },
      take: RECENT_EVENTS,
      select: { memberHash: true, eventType: true, occurredAt: true, contextId: true },
    });

    if (events.length === 0) {
      out('\nNão há nada registrado ainda.\n');
    } else {
      out(`\nOs últimos ${events.length} acontecimentos\n`);
      for (const event of events) {
        const channel = resolveChannelName(event.contextId);
        const where = channel ? ` no #${channel}` : '';
        out(`  ${formatDate(event.occurredAt)} — ${unknown(event.memberHash)} ${label(event.eventType)}${where}`);
      }
      out();
    }
  } else {
    const grouped = await prisma.memberEvent.groupBy({
      by: ['memberHash', 'eventType'],
      _count: { _all: true },
      _max: { occurredAt: true },
    });

    if (grouped.length === 0) {
      out('\nNão há nada registrado ainda. Rode `pnpm backfill --all` primeiro.\n');
    } else {
      const profiles = await prisma.memberProfile.findMany({
        select: { memberHash: true, currentLevel: true },
      });
      const levels = new Map(profiles.map((row) => [row.memberHash, row.currentLevel]));

      interface Person {
        memberHash: string;
        total: number;
        lastActivity: Date | null;
        actions: { text: string; count: number }[];
      }

      const people = new Map<string, Person>();
      for (const row of grouped) {
        const person = people.get(row.memberHash) ?? {
          memberHash: row.memberHash,
          total: 0,
          lastActivity: null,
          actions: [],
        };

        person.total += row._count._all;
        person.actions.push({ text: label(row.eventType), count: row._count._all });

        const last = row._max.occurredAt;
        if (last && (!person.lastActivity || last > person.lastActivity)) {
          person.lastActivity = last;
        }

        people.set(row.memberHash, person);
      }

      const ranked = [...people.values()].sort((a, b) => b.total - a.total);

      out(`\n${plural(ranked.length, 'pessoa', 'pessoas')} com atividade registrada\n`);

      let position = 1;
      for (const person of ranked) {
        const level = levels.get(person.memberHash);
        const levelText =
          level === undefined ? 'ainda não classificado' : levelName(level as EngagementLevel);

        out(`${String(position).padStart(2)}. ${unknown(person.memberHash)} — ${levelText}`);
        out(
          `    ${plural(person.total, 'ação', 'ações')}` +
            (person.lastActivity ? ` · última em ${formatDate(person.lastActivity)}` : ''),
        );

        const actions = [...person.actions].sort((a, b) => b.count - a.count);
        const width = Math.max(...actions.map((action) => action.text.length));
        for (const action of actions) {
          const dots = '.'.repeat(Math.max(3, width - action.text.length + 4));
          out(`       ${action.text} ${dots} ${action.count}`);
        }

        out();
        position += 1;
      }
    }
  }
} catch (error) {
  logger.error({ err: error }, 'ver falhou');
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
