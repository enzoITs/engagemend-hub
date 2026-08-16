import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { classify } from '../classifier/run.js';
import { ingestYoutubeEvents, loadUniversalEvents } from '../ingest/youtube.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { appendJobLog, markJobDone, markJobError } from '../store/jobs.js';
import { spawnYoutubePipeline } from './spawn-python.js';
export async function runYoutubeSync(jobId: string, channelId: string, channelName: string, dataRoot: string): Promise<void> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { ownerId: true } });
  await prisma.community.upsert({ where: { platform_externalId: { platform: 'youtube', externalId: channelId } }, create: { platform: 'youtube', externalId: channelId, name: channelName, ownerId: job.ownerId, syncState: 'sincronizando' }, update: { name: channelName, syncState: 'sincronizando', disabledAt: null } });
  const channelDir = join(dataRoot, channelId); await mkdir(channelDir, { recursive: true });
  const result = await spawnYoutubePipeline(channelId, channelDir); await appendJobLog(jobId, result.stdout + result.stderr);
  if (result.exitCode !== 0) { const message = result.stderr.trim() || `pipeline saiu com código ${result.exitCode}`; await markJobError(jobId, message); await prisma.community.updateMany({ where: { platform: 'youtube', externalId: channelId }, data: { syncState: 'erro' } }); logger.error({ jobId, channelId, message }, 'youtube_sync falhou'); return; }
  const comments = loadUniversalEvents(join(channelDir, 'data', 'youtube_events.json')); await ingestYoutubeEvents(comments, channelId, channelName); await classify(); await prisma.community.updateMany({ where: { platform: 'youtube', externalId: channelId }, data: { syncState: 'conectada', syncedAt: new Date() } }); await markJobDone(jobId); logger.info({ jobId, channelId, comments: comments.length }, 'youtube_sync concluído');
}
