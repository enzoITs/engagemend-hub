import { Command } from 'commander';
import { Events } from 'discord.js';

import { Collector, listGuildChannels } from '../collector/bot.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma } from '../lib/prisma.js';
import { countEvents, latestEventAt } from '../store/events.js';

/**
 * `pnpm collect` — sobe o coletor em tempo real e fica no ar.
 * `pnpm collect --list-channels` — conecta, imprime os canais e sai.
 */

const program = new Command()
  .name('collect')
  .description('Coletor de engajamento do Discord em tempo real')
  .option('--list-channels', 'lista os canais do guild (id, nome, tipo) e encerra')
  .option('--guild <id>', 'guild pra listar canais (default: DISCORD_GUILD_ID)')
  .parse();

const options = program.opts<{ listChannels?: boolean; guild?: string }>();

const collector = new Collector();

async function waitForReady(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    collector.client.once(Events.ClientReady, () => resolve());
    collector.client.once(Events.Error, reject);
    void collector.login().catch(reject);
  });
}

async function listChannels(): Promise<void> {
  await waitForReady();

  // O handler de ready roda em paralelo; espera o guild aparecer.
  const guildId = options.guild ?? env.DISCORD_GUILD_ID ?? '';
  if (!guildId) program.error('informe --guild ou defina DISCORD_GUILD_ID no ambiente');
  const guild = await collector.client.guilds.fetch(guildId);
  const rows = await listGuildChannels(guild);

  const width = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    type: Math.max(4, ...rows.map((r) => r.type.length)),
  };

  const line = (id: string, name: string, type: string, parent: string) =>
    `${id.padEnd(width.id)}  ${name.padEnd(width.name)}  ${type.padEnd(width.type)}  ${parent}`;

  process.stdout.write(`\nGuild: ${guild.name} (${guild.id}) — ${rows.length} canais\n\n`);
  process.stdout.write(`${line('ID', 'NOME', 'TIPO', 'CATEGORIA')}\n`);
  for (const row of rows) {
    process.stdout.write(`${line(row.id, row.name, row.type, row.parent ?? '—')}\n`);
  }
  process.stdout.write('\n');
}

async function collect(): Promise<void> {
  await waitForReady();

  const guildId = options.guild ?? env.DISCORD_GUILD_ID ?? '';
  if (!guildId) program.error('informe --guild ou defina DISCORD_GUILD_ID no ambiente');
  const total = await countEvents(guildId);
  const latest = await latestEventAt(guildId);
  logger.info(
    { eventos: total, ultimo: latest?.toISOString() ?? null },
    'coletor no ar — Ctrl+C para encerrar',
  );

  await new Promise<void>((resolve) => {
    const stop = (signal: string) => {
      logger.info({ signal }, 'encerrando');
      resolve();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}

try {
  if (options.listChannels) {
    await listChannels();
  } else {
    await collect();
  }
} catch (error) {
  logger.error({ err: error }, 'coletor falhou');
  process.exitCode = 1;
} finally {
  await collector.shutdown();
  await disconnectPrisma();
}
