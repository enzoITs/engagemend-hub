import { describe, expect, it, vi } from 'vitest';

describe('env', () => {
  it('aceita ambiente válido sem DISCORD_GUILD_ID (opcional na Fase 2)', async () => {
    vi.resetModules();
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: '123456789012345678',
      MEMBER_ID_SALT: 'x'.repeat(32),
      RESEND_API_KEY: 're_test',
      PUBLIC_URL: 'http://localhost:3000',
    };
    vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
    vi.stubEnv('DISCORD_TOKEN', base.DISCORD_TOKEN);
    vi.stubEnv('DISCORD_CLIENT_ID', base.DISCORD_CLIENT_ID);
    vi.stubEnv('MEMBER_ID_SALT', base.MEMBER_ID_SALT);
    vi.stubEnv('RESEND_API_KEY', base.RESEND_API_KEY);
    vi.stubEnv('PUBLIC_URL', base.PUBLIC_URL);
    vi.stubEnv('DISCORD_GUILD_ID', '');

    const { env } = await import('../src/config/env.js');
    expect(env.DISCORD_GUILD_ID).toBeUndefined();
    expect(env.DISCORD_CLIENT_ID).toBe(base.DISCORD_CLIENT_ID);
  });

  it('permite modo local sem autenticar o bot Discord', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@localhost:5432/db');
    vi.stubEnv('DISCORD_TOKEN', 'token');
    vi.stubEnv('DISCORD_CLIENT_ID', '123456789012345678');
    vi.stubEnv('MEMBER_ID_SALT', 'x'.repeat(32));
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('YOUTUBE_API_KEY', 'yt_test');
    vi.stubEnv('PUBLIC_URL', 'http://localhost:3000');
    vi.stubEnv('DISCORD_ENABLED', 'false');
    const { env } = await import('../src/config/env.js');
    expect(env.DISCORD_ENABLED).toBe(false);
  });
});
