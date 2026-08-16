import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { enqueueJob, getJob } from '../src/store/jobs.js';
vi.mock('../src/worker/youtube-sync.js', () => ({ runYoutubeSync: vi.fn(async () => {}) }));
vi.mock('../src/worker/discord-backfill.js', () => ({ runDiscordBackfill: vi.fn(async () => {}) }));
const { runYoutubeSync } = await import('../src/worker/youtube-sync.js');
const { runDiscordBackfill } = await import('../src/worker/discord-backfill.js');
const { startWorkerLoop } = await import('../src/worker/loop.js');
beforeEach(async () => { await prisma.memberEvent.deleteMany(); await prisma.community.deleteMany(); await prisma.job.deleteMany(); await prisma.session.deleteMany(); await prisma.magicLinkToken.deleteMany(); await prisma.user.deleteMany(); vi.mocked(runYoutubeSync).mockClear(); vi.mocked(runDiscordBackfill).mockClear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
afterAll(async () => { await disconnectPrisma(); });
describe('startWorkerLoop', () => {
  it('processa youtube', async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } });
    const job = await enqueueJob(user.id, 'youtube_sync', { channelId: 'UC1', channelName: 'Canal' });
    vi.mocked(runYoutubeSync).mockImplementation(async (id) => { const { markJobDone } = await import('../src/store/jobs.js'); await markJobDone(id); });
    const handle = startWorkerLoop({} as never, '/tmp/engagemend-jobs-teste', 5); await vi.advanceTimersByTimeAsync(5); await vi.waitFor(() => expect(runYoutubeSync).toHaveBeenCalledWith(job.id, 'UC1', 'Canal', '/tmp/engagemend-jobs-teste')); handle.stop();
    expect((await getJob(job.id, user.id))?.status).toBe('done');
  });
  it('processa discord', async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } });
    const job = await enqueueJob(user.id, 'discord_backfill', { guildId: '123456789012345678' }); const client = {} as never;
    vi.mocked(runDiscordBackfill).mockImplementation(async (id) => { const { markJobDone } = await import('../src/store/jobs.js'); await markJobDone(id); });
    const handle = startWorkerLoop(client, '/tmp', 5); await vi.advanceTimersByTimeAsync(5); await vi.waitFor(() => expect(runDiscordBackfill).toHaveBeenCalledWith(job.id, '123456789012345678', client)); handle.stop();
  });
  it('não processa segundo job em paralelo', async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } }); await enqueueJob(user.id, 'youtube_sync', { channelId: 'UC1', channelName: '1' }); await enqueueJob(user.id, 'youtube_sync', { channelId: 'UC2', channelName: '2' }); let release!: () => void;
    vi.mocked(runYoutubeSync).mockImplementation(() => new Promise((resolve) => { release = () => resolve(); })); const handle = startWorkerLoop({} as never, '/tmp', 5); await vi.advanceTimersByTimeAsync(5); await vi.waitFor(() => expect(runYoutubeSync).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(5); expect(runYoutubeSync).toHaveBeenCalledTimes(1); release(); handle.stop();
  });
});
