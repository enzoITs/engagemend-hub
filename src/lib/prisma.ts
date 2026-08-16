import { PrismaClient } from '@prisma/client';

import { logger } from './logger.js';

/**
 * Cliente único do processo.
 *
 * Não está no mapa de arquivos do §4 — o §4 não previu onde o cliente moraria.
 * `lib/` é o vizinho natural do logger e mantém `store/` sendo só regra de
 * escrita, sem dono de conexão.
 */
export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('warn', (event) => logger.warn({ prisma: event.message }, 'prisma warn'));
prisma.$on('error', (event) => logger.error({ prisma: event.message }, 'prisma error'));

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
