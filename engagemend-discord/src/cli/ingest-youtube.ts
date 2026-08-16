import { Command } from 'commander';

import { ingestYoutubeEvents, loadUniversalEvents } from '../ingest/youtube.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma } from '../lib/prisma.js';

/**
 * `npx tsx src/cli/ingest-youtube.ts --file data/youtube_events.json --channel-id UC... --channel-name "..."`
 *
 * Lê o schema universal exportado por `engagemend-youtube/main.py` e grava
 * como `MemberEvent`s na comunidade YouTube correspondente.
 */

const program = new Command()
  .name('ingest-youtube')
  .description('Ingere comentários do YouTube (schema universal) no event store')
  .requiredOption('--file <caminho>', 'JSON no schema universal (youtube_events.json)')
  .requiredOption('--channel-id <id>', 'ID do canal YouTube (UC...)')
  .requiredOption('--channel-name <nome>', 'Nome do canal, para exibição')
  .parse();

const options = program.opts<{
  file: string;
  channelId: string;
  channelName: string;
}>();

try {
  const comments = loadUniversalEvents(options.file);
  const result = await ingestYoutubeEvents(comments, options.channelId, options.channelName);

  process.stdout.write(
    `\n${comments.length} comentários lidos | ${result.identities} autores | ` +
      `${result.inserted} eventos gravados | ${result.skipped} ignorados (duplicados)\n\n`,
  );
} catch (error) {
  logger.error({ err: error }, 'ingest-youtube falhou');
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
