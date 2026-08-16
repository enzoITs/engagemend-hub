import type { Client } from 'discord.js';
import { logger } from '../lib/logger.js';
import { markJobError, markJobRunning, nextQueuedJob } from '../store/jobs.js';
import { runDiscordBackfill } from './discord-backfill.js';
import { runYoutubeSync } from './youtube-sync.js';

export function startWorkerLoop(client: Client | null, dataRoot: string, tickMs = 5000): { stop(): void } {
  let isProcessing = false;
  const timer = setInterval(() => {
    if (isProcessing) return;
    isProcessing = true;
    void (async () => {
      const job = await nextQueuedJob();
      if (!job) { isProcessing = false; return; }
      try {
        await markJobRunning(job.id);
        if (job.kind === 'youtube_sync') {
          const payload = job.payload as { channelId: string; channelName: string };
          await runYoutubeSync(job.id, payload.channelId, payload.channelName, dataRoot);
        } else if (job.kind === 'discord_backfill') {
          const payload = job.payload as { guildId: string };
          if (client) await runDiscordBackfill(job.id, payload.guildId, client);
          else {
            await markJobError(job.id, 'integração Discord desabilitada neste processo');
            logger.warn({ jobId: job.id }, 'job Discord recusado: integração desabilitada');
          }
        } else logger.warn({ jobId: job.id, kind: job.kind }, 'tipo de job desconhecido');
      } finally { isProcessing = false; }
    })();
  }, tickMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
