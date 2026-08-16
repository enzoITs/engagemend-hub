import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { enqueueJob, nextQueuedJob, markJobRunning, markJobDone, markJobError, appendJobLog, getJob, requeueStuckJobs } from '../src/store/jobs.js';
async function makeUser() { return (await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } })).id; }
beforeEach(async () => { await prisma.job.deleteMany(); await prisma.user.deleteMany(); });
afterAll(async () => { await disconnectPrisma(); });
describe('fila de jobs', () => {
  it('pega o mais antigo primeiro', async () => { const owner = await makeUser(); const first = await enqueueJob(owner, 'youtube_sync', { channelId: 'UC1' }); await new Promise((r) => setTimeout(r, 5)); await enqueueJob(owner, 'youtube_sync', { channelId: 'UC2' }); expect((await nextQueuedJob())?.id).toBe(first.id); });
  it('ignora jobs não queued', async () => { expect(await nextQueuedJob()).toBeNull(); });
  it('running e done fecham o ciclo', async () => { const owner = await makeUser(); const job = await enqueueJob(owner, 'discord_backfill', { guildId: '123' }); await markJobRunning(job.id); expect(await nextQueuedJob()).toBeNull(); await markJobDone(job.id); expect((await getJob(job.id, owner))?.status).toBe('done'); });
  it('grava erro', async () => { const owner = await makeUser(); const job = await enqueueJob(owner, 'youtube_sync', {}); await markJobError(job.id, 'quotaExceeded'); expect((await getJob(job.id, owner))?.error).toBe('quotaExceeded'); });
  it('trunca log em 4000 chars', async () => { const owner = await makeUser(); const job = await enqueueJob(owner, 'youtube_sync', {}); await appendJobLog(job.id, 'a'.repeat(3000)); await appendJobLog(job.id, 'b'.repeat(3000)); const view = await getJob(job.id, owner); expect(view?.log?.length).toBe(4000); expect(view?.log?.endsWith('b')).toBe(true); });
  it('escopa por dono', async () => { const owner = await makeUser(); const other = await makeUser(); const job = await enqueueJob(owner, 'youtube_sync', {}); expect(await getJob(job.id, other)).toBeNull(); });
  it('requeue jobs presos', async () => { const owner = await makeUser(); const job = await enqueueJob(owner, 'youtube_sync', {}); await markJobRunning(job.id); expect(await requeueStuckJobs()).toBe(1); expect((await nextQueuedJob())?.id).toBe(job.id); });
});
