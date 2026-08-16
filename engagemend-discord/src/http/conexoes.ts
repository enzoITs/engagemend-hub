import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { enqueueJob, getJob } from '../store/jobs.js';
import { fetchYoutubeChannelInfo } from './youtube-channel-info.js';
import { fetchDiscordGuildName } from './discord-guild-info.js';
const body = z.object({ plataforma: z.literal('youtube'), identificador: z.string().min(1) });
const WHATSAPP_UPLOAD_DIR = process.env['WHATSAPP_JOB_DATA_ROOT'] ?? './data/whatsapp-jobs';
/** Limite de export do WhatsApp — grupos grandes ultrapassam 50 MB, o próprio pipeline permite até 200 MB por padrão. */
const WHATSAPP_MAX_UPLOAD_MB = 200;
export async function registerConexoesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/conexoes', async (request, reply) => { const parsed = body.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'payload inválido' }); const channelId = parsed.data.identificador; const existing = await prisma.community.findUnique({ where: { platform_externalId: { platform: 'youtube', externalId: channelId } } }); if (existing) return reply.code(409).send({ error: 'canal já conectado' }); const info = await fetchYoutubeChannelInfo(channelId, env.YOUTUBE_API_KEY); const community = await prisma.community.create({ data: { platform: 'youtube', externalId: channelId, name: info.name, ownerId: request.user.id, syncState: 'sincronizando' } }); const job = await enqueueJob(request.user.id, 'youtube_sync', { channelId, channelName: info.name }); return reply.code(201).send({ id: community.id, plataforma: 'youtube', nome: community.name, estadoSync: 'sincronizando', jobId: job.id }); });
  /**
   * WhatsApp não tem API pra reconsultar — o `.txt` só existe porque o
   * usuário fez export manual e sobe aqui, uma vez por sincronização
   * (ver `engagemend-whatsapp/README.md`, §"Limitação conhecida da fonte").
   * Grava em disco só até o worker consumir; `runWhatsappSync` apaga em
   * seguida, dando certo ou errado.
   */
  app.post('/conexoes/whatsapp', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: WHATSAPP_MAX_UPLOAD_MB * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'arquivo .txt ausente' });
    const groupName = (file.fields['grupo'] as { value?: string } | undefined)?.value?.trim();
    if (!groupName) return reply.code(400).send({ error: 'campo "grupo" ausente' });

    await mkdir(WHATSAPP_UPLOAD_DIR, { recursive: true });
    const inputFile = join(WHATSAPP_UPLOAD_DIR, `${randomUUID()}.txt`);
    await writeFile(inputFile, await file.toBuffer());

    const job = await enqueueJob(request.user.id, 'whatsapp_sync', { groupName, inputFile });
    return reply.code(201).send({ plataforma: 'whatsapp', nome: groupName, estadoSync: 'sincronizando', jobId: job.id });
  });

  app.get('/api/jobs/:id', async (request, reply) => { const { id } = request.params as { id: string }; const job = await getJob(id, request.user.id); if (!job) return reply.code(404).send({ error: 'job não encontrado' }); return { id: job.id, kind: job.kind, status: job.status, log: job.log, error: job.error, createdAt: job.createdAt, finishedAt: job.finishedAt }; });
  app.post('/api/jobs/:id/retry', async (request, reply) => { const { id } = request.params as { id: string }; const job = await getJob(id, request.user.id); if (!job) return reply.code(404).send({ error: 'job não encontrado' }); if (job.status !== 'error') return reply.code(400).send({ error: 'só jobs com erro podem ser retentados' }); if (job.kind === 'whatsapp_sync') return reply.code(400).send({ error: 'whatsapp_sync não pode ser retentado — o .txt enviado já foi apagado, refaça o upload' }); const retried = await enqueueJob(request.user.id, job.kind as 'youtube_sync' | 'discord_backfill', job.payload as Record<string, unknown>); return reply.code(201).send({ jobId: retried.id }); });
  app.get('/api/discord/invite-url', async (_request, reply) => { const url = new URL('https://discord.com/api/oauth2/authorize'); url.searchParams.set('client_id', env.DISCORD_CLIENT_ID); url.searchParams.set('scope', 'bot'); url.searchParams.set('permissions', '66560'); url.searchParams.set('redirect_uri', `${env.PUBLIC_URL}/api/discord/callback`); url.searchParams.set('response_type', 'code'); return reply.send({ url: url.toString() }); });
  app.get('/api/discord/callback', async (request, reply) => { const { guild_id: guildId } = request.query as { guild_id?: string }; if (!guildId) return reply.code(400).send({ error: 'guild_id ausente' }); const existing = await prisma.community.findUnique({ where: { platform_externalId: { platform: 'discord', externalId: guildId } } }); if (existing) return reply.code(409).send({ error: 'servidor já conectado' }); const name = await fetchDiscordGuildName(guildId); const community = await prisma.community.create({ data: { platform: 'discord', externalId: guildId, name, ownerId: request.user.id, syncState: 'sincronizando' } }); await enqueueJob(request.user.id, 'discord_backfill', { guildId }); return reply.redirect(`/?comunidade=${community.id}`, 302); });
}
