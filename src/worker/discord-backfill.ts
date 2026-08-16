import type { Client } from 'discord.js';
import { runBackfill } from '../collector/backfill.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { markJobDone, markJobError } from '../store/jobs.js';
export async function runDiscordBackfill(jobId: string, guildId: string, client: Client): Promise<void> { try { const guild = await client.guilds.fetch(guildId); await guild.members.fetch(); await runBackfill(guild, { channelIds: [], all: true, limit: 500, since: null, reactions: true, threads: true, reset: false }); await prisma.community.updateMany({ where: { platform: 'discord', externalId: guildId }, data: { syncState: 'conectada', syncedAt: new Date() } }); await markJobDone(jobId); logger.info({ jobId, guildId }, 'discord_backfill concluído'); } catch (error) { const message = error instanceof Error ? error.message : String(error); await markJobError(jobId, message); await prisma.community.updateMany({ where: { platform: 'discord', externalId: guildId }, data: { syncState: 'erro' } }); logger.error({ jobId, guildId, err: error }, 'discord_backfill falhou'); } }
