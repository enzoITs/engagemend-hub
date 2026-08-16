import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { classify } from '../classifier/run.js';
import { ingestWhatsappMessages, loadWhatsAppRecords, resolveWhatsappCommunity } from '../ingest/whatsapp.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { appendJobLog, markJobDone, markJobError } from '../store/jobs.js';
import { spawnWhatsappPipeline } from './spawn-python.js';

/**
 * Diferente de `youtube_sync` (channelId reconsultável via API) e
 * `discord_backfill` (guildId reconsultável via bot), WhatsApp não tem API
 * — o `.txt` só existe porque o usuário fez upload uma vez (§ HTTP
 * `POST /conexoes/whatsapp`). `inputFile` é esse upload, gravado em
 * `dataRoot` antes do job entrar na fila; é apagado depois do pipeline
 * rodar, dando certo ou errado — nunca fica no disco além do necessário.
 */
export async function runWhatsappSync(
  jobId: string,
  groupName: string,
  inputFile: string,
  dataRoot: string,
): Promise<void> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { ownerId: true } });
  const outputDir = join(dataRoot, jobId);
  await mkdir(outputDir, { recursive: true });

  const result = await spawnWhatsappPipeline(inputFile, groupName, outputDir);
  await appendJobLog(jobId, result.stdout + result.stderr);
  await unlink(inputFile).catch(() => {});

  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || `pipeline saiu com código ${result.exitCode}`;
    await markJobError(jobId, message);
    logger.error({ jobId, message }, 'whatsapp_sync falhou');
    return;
  }

  const messages = loadWhatsAppRecords(join(outputDir, 'output.json'));
  const groupHash = messages[0]?.group_hash;
  if (!groupHash) {
    await markJobError(jobId, 'pipeline não produziu nenhuma mensagem (arquivo vazio ou só mensagens de sistema)');
    return;
  }

  const communityId = await resolveWhatsappCommunity(groupHash, groupName, job.ownerId);
  await ingestWhatsappMessages(messages, groupHash, communityId);
  await classify();
  await prisma.community.updateMany({
    where: { platform: 'whatsapp', externalId: groupHash },
    data: { syncState: 'conectada', syncedAt: new Date() },
  });
  await markJobDone(jobId);
  logger.info({ jobId, groupHash, messages: messages.length }, 'whatsapp_sync concluído');
}
