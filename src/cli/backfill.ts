import { Command, InvalidArgumentError } from 'commander';
import { Events } from 'discord.js';

import { runBackfill, type BackfillOptions } from '../collector/backfill.js';
import { createClient } from '../collector/bot.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma } from '../lib/prisma.js';

/**
 * `pnpm backfill --channel=<id> --limit=500`
 *
 * Rodar duas vezes seguidas não duplica evento: o `dedupe_key` barra no banco e
 * o checkpoint em disco evita repaginar.
 */

function positiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('precisa ser um inteiro positivo');
  }
  return parsed;
}

function isoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidArgumentError('data inválida — use ISO, ex.: 2026-01-01');
  }
  return parsed;
}

function repeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const program = new Command()
  .name('backfill')
  .description('Varredura histórica paginada de um ou mais canais')
  .option('--guild <id>', 'guild da varredura (default: DISCORD_GUILD_ID)')
  .option('--channel <id>', 'canal a varrer (pode repetir)', repeatable, [])
  .option('--all', 'varre todos os canais de texto não-ignored', false)
  .option('--limit <n>', 'teto de mensagens por canal', positiveInt, 500)
  .option('--since <data>', 'para de paginar ao passar desta data (ISO)', isoDate)
  .option('--no-reactions', 'não relê reações (bem mais rápido, perde influência)')
  .option('--no-threads', 'não entra nas threads')
  .option('--reset', 'zera o checkpoint antes de começar', false)
  .parse();

const raw = program.opts<{
  channel: string[];
  all: boolean;
  limit: number;
  since?: Date;
  reactions: boolean;
  threads: boolean;
  reset: boolean;
  guild?: string;
}>();

if (raw.channel.length === 0 && !raw.all) {
  program.error('informe --channel <id> (pode repetir) ou --all');
}

const options: BackfillOptions = {
  channelIds: raw.channel,
  all: raw.all,
  limit: raw.limit,
  since: raw.since ?? null,
  reactions: raw.reactions,
  threads: raw.threads,
  reset: raw.reset,
};

const client = createClient();

client.rest.on('rateLimited', (info) => {
  logger.warn(
    { route: info.route, timeToReset: info.timeToReset, global: info.global },
    'rate limit do Discord — aguardando',
  );
});

try {
  await new Promise<void>((resolve, reject) => {
    client.once(Events.ClientReady, () => resolve());
    client.once(Events.Error, reject);
    void client.login(env.DISCORD_TOKEN).catch(reject);
  });

  const guildId = raw.guild ?? env.DISCORD_GUILD_ID ?? '';
  if (!guildId) program.error('informe --guild ou defina DISCORD_GUILD_ID no ambiente');
  const guild = await client.guilds.fetch(guildId);
  // `joinedAtOf` (newcomer_welcomed) lê deste cache.
  await guild.members.fetch();

  const summary = await runBackfill(guild, options);

  const width = Math.max(5, ...summary.channels.map((row) => row.name.length));
  process.stdout.write('\nCANAL'.padEnd(width + 3));
  process.stdout.write('MSGS   EVENTOS  INSERIDOS  DUPLICADOS  FIM\n');
  for (const row of summary.channels) {
    process.stdout.write(
      `${row.name.padEnd(width + 2)} ${String(row.messages).padEnd(6)} ${String(row.events).padEnd(8)} ${String(
        row.inserted,
      ).padEnd(10)} ${String(row.skipped).padEnd(11)} ${row.done ? 'sim' : 'não'}\n`,
    );
  }
  const { messages, events, inserted, skipped } = summary.totals;
  process.stdout.write(
    `\ntotal: ${messages} mensagens, ${events} eventos, ${inserted} inseridos, ${skipped} já existentes\n\n`,
  );
} catch (error) {
  logger.error({ err: error }, 'backfill falhou');
  process.exitCode = 1;
} finally {
  await client.destroy();
  await disconnectPrisma();
}
