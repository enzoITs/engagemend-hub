import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
const LOG_MAX_CHARS = 4000;
export interface JobView { id: string; kind: string; status: string; payload: unknown; log: string | null; error: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null; }
export async function enqueueJob(ownerId: string, kind: 'youtube_sync' | 'discord_backfill', payload: Record<string, unknown>): Promise<{ id: string }> { const job = await prisma.job.create({ data: { ownerId, kind, payload: payload as Prisma.InputJsonObject, status: 'queued' } }); return { id: job.id }; }
export async function nextQueuedJob(): Promise<{ id: string; ownerId: string; kind: string; payload: unknown } | null> { const job = await prisma.job.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } }); return job ? { id: job.id, ownerId: job.ownerId, kind: job.kind, payload: job.payload } : null; }
export async function markJobRunning(id: string): Promise<void> { await prisma.job.update({ where: { id }, data: { status: 'running', startedAt: new Date() } }); }
export async function markJobDone(id: string): Promise<void> { await prisma.job.update({ where: { id }, data: { status: 'done', finishedAt: new Date() } }); }
export async function markJobError(id: string, error: string): Promise<void> { await prisma.job.update({ where: { id }, data: { status: 'error', error, finishedAt: new Date() } }); }
export async function appendJobLog(id: string, chunk: string): Promise<void> { const job = await prisma.job.findUniqueOrThrow({ where: { id }, select: { log: true } }); const merged = (job.log ?? '') + chunk; await prisma.job.update({ where: { id }, data: { log: merged.length > LOG_MAX_CHARS ? merged.slice(-LOG_MAX_CHARS) : merged } }); }
export async function getJob(id: string, ownerId: string): Promise<JobView | null> { const job = await prisma.job.findFirst({ where: { id, ownerId } }); return job ? { id: job.id, kind: job.kind, status: job.status, payload: job.payload, log: job.log, error: job.error, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt } : null; }
export async function requeueStuckJobs(): Promise<number> { return (await prisma.job.updateMany({ where: { status: 'running' }, data: { status: 'queued', startedAt: null } })).count; }
