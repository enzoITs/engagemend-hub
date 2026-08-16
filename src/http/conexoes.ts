import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { enqueueJob, getJob } from '../store/jobs.js';
import { fetchYoutubeChannelInfo } from './youtube-channel-info.js';
const body = z.object({ plataforma: z.literal('youtube'), identificador: z.string().min(1) });
export async function registerConexoesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/conexoes', async (request, reply) => { const parsed = body.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'payload inválido' }); const channelId = parsed.data.identificador; const existing = await prisma.community.findUnique({ where: { platform_externalId: { platform: 'youtube', externalId: channelId } } }); if (existing) return reply.code(409).send({ error: 'canal já conectado' }); const info = await fetchYoutubeChannelInfo(channelId, env.YOUTUBE_API_KEY); const community = await prisma.community.create({ data: { platform: 'youtube', externalId: channelId, name: info.name, ownerId: request.user.id, syncState: 'sincronizando' } }); const job = await enqueueJob(request.user.id, 'youtube_sync', { channelId, channelName: info.name }); return reply.code(201).send({ id: community.id, plataforma: 'youtube', nome: community.name, estadoSync: 'sincronizando', jobId: job.id }); });
  app.get('/api/jobs/:id', async (request, reply) => { const { id } = request.params as { id: string }; const job = await getJob(id, request.user.id); if (!job) return reply.code(404).send({ error: 'job não encontrado' }); return { id: job.id, kind: job.kind, status: job.status, log: job.log, error: job.error, createdAt: job.createdAt, finishedAt: job.finishedAt }; });
  app.post('/api/jobs/:id/retry', async (request, reply) => { const { id } = request.params as { id: string }; const job = await getJob(id, request.user.id); if (!job) return reply.code(404).send({ error: 'job não encontrado' }); if (job.status !== 'error') return reply.code(400).send({ error: 'só jobs com erro podem ser retentados' }); const retried = await enqueueJob(request.user.id, job.kind as 'youtube_sync' | 'discord_backfill', job.payload as Record<string, unknown>); return reply.code(201).send({ jobId: retried.id }); });
}
