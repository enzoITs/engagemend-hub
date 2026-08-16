import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { enqueueJob, getJob } from '../src/store/jobs.js';
vi.mock('../src/worker/spawn-python.js', () => ({ spawnYoutubePipeline: vi.fn() }));
const { spawnYoutubePipeline } = await import('../src/worker/spawn-python.js');
const { runYoutubeSync } = await import('../src/worker/youtube-sync.js');
let dataRoot: string;
beforeEach(async () => { await prisma.memberEvent.deleteMany(); await prisma.community.deleteMany(); await prisma.job.deleteMany(); await prisma.memberProfile.deleteMany(); await prisma.levelTransition.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany(); dataRoot = await mkdtemp(join(tmpdir(), 'engagemend-yt-')); vi.mocked(spawnYoutubePipeline).mockReset(); });
afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });
afterAll(async () => { await disconnectPrisma(); });
describe('runYoutubeSync', () => {
  it('sucesso ingere, classifica e conclui', async () => { const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } }); const job = await enqueueJob(user.id, 'youtube_sync', { channelId: 'UC_TESTE', channelName: 'Canal' }); const dir = join(dataRoot, 'UC_TESTE', 'data'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'youtube_events.json'), JSON.stringify([{ event_id: 'ev1', platform: 'youtube', author_id: 'a1', author_display_name: 'Fulano', content_id: 'v1', published_at: new Date().toISOString(), quality_score: 0.9, categorias: 'contribuicao_valor' }])); vi.mocked(spawnYoutubePipeline).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }); await runYoutubeSync(job.id, 'UC_TESTE', 'Canal', dataRoot); expect((await getJob(job.id, user.id))?.status).toBe('done'); expect(await prisma.memberEvent.count()).toBeGreaterThan(0); });
  it('falha marca job e comunidade como erro', async () => { const user = await prisma.user.create({ data: { email: `${randomUUID()}@teste.local` } }); const job = await enqueueJob(user.id, 'youtube_sync', { channelId: 'UC_FALHA', channelName: 'Canal' }); vi.mocked(spawnYoutubePipeline).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'quotaExceeded' }); await runYoutubeSync(job.id, 'UC_FALHA', 'Canal', dataRoot); expect((await getJob(job.id, user.id))?.status).toBe('error'); expect((await prisma.community.findFirst({ where: { externalId: 'UC_FALHA' } }))?.syncState).toBe('erro'); });
});
