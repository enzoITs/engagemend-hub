import staticPlugin from '@fastify/static';
import { createClient } from './collector/bot.js';
import { env } from './config/env.js';
import { buildServer } from './http/server.js';
import { logger } from './lib/logger.js';
import { requeueStuckJobs } from './store/jobs.js';
import { startWorkerLoop } from './worker/loop.js';
const DATA_ROOT = process.env['YOUTUBE_JOB_DATA_ROOT'] ?? './data/youtube-jobs';
const PORT = Number(process.env['PORT'] ?? 3000);
async function main() { const requeued = await requeueStuckJobs(); if (requeued) logger.warn({ requeued }, 'jobs presos voltaram pra fila'); const client = createClient(); await client.login(env.DISCORD_TOKEN); const worker = startWorkerLoop(client, DATA_ROOT); const app = buildServer(); await app.register(staticPlugin, { root: process.env['FRONTEND_ROOT'] ?? new URL('../../', import.meta.url).pathname, index: ['engagemend-painel-v4-http.html'] }); await app.listen({ port: PORT, host: '0.0.0.0' }); logger.info({ port: PORT }, 'servidor HTTP no ar'); const shutdown = async () => { worker.stop(); await client.destroy(); await app.close(); process.exit(0); }; process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown); }
main().catch((error) => { logger.fatal({ err: error }, 'falha fatal no boot'); process.exit(1); });
