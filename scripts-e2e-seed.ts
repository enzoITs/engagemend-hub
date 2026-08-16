import { createHmac } from 'node:crypto';

import { env } from './src/config/env.js';
import { rememberIdentities } from './src/store/identity.js';
import { insertEvents } from './src/store/events.js';
import { disconnectPrisma, prisma } from './src/lib/prisma.js';
import type { MemberEvent } from './src/types/scoring.js';

const GUILD_ID = env.DISCORD_GUILD_ID;

function hash(externalUserId: string): string {
  return createHmac('sha256', env.MEMBER_ID_SALT).update(`discord:${externalUserId}`).digest('hex');
}

async function main() {
  const community = await prisma.community.upsert({
    where: { platform_externalId: { platform: 'discord', externalId: GUILD_ID } },
    create: { platform: 'discord', externalId: GUILD_ID, name: 'Discord (e2e seed)' },
    update: {},
  });

  await rememberIdentities([
    { platform: 'discord', externalUserId: 'd1', discordId: 'd1', username: 'ana', isBot: false },
    { platform: 'discord', externalUserId: 'd2', discordId: 'd2', username: 'bruno', isBot: false },
  ]);

  const now = new Date();
  const events: MemberEvent[] = [];
  for (let i = 0; i < 20; i++) {
    events.push({
      memberHash: hash('d1'),
      source: 'discord',
      eventType: 'message_sent',
      occurredAt: new Date(now.getTime() - i * 3600_000),
    });
  }
  for (let i = 0; i < 5; i++) {
    events.push({
      memberHash: hash('d2'),
      source: 'discord',
      eventType: 'reaction_given',
      occurredAt: new Date(now.getTime() - i * 3600_000),
    });
  }

  const result = await insertEvents(events, GUILD_ID, community.id);
  console.log(result);
  await disconnectPrisma();
}

main();
