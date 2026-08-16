import { Command, InvalidArgumentError } from 'commander';

import '../config/env.js';
import { classify } from '../classifier/run.js';
import { levelName } from '../classifier/level.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma } from '../lib/prisma.js';
import type { EngagementLevel } from '../types/scoring.js';

/**
 * `pnpm classify`                    — classifica com histerese
 * `pnpm classify --full-recompute`   — reaplica os pesos novos direto (§1.4)
 * `pnpm classify --dry-run`          — mostra o resultado sem gravar nada
 */

function isoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidArgumentError('data inválida — use ISO, ex.: 2026-08-01');
  }
  return parsed;
}

const program = new Command()
  .name('classify')
  .description('Classifica os membros a partir do event store')
  .option('--full-recompute', 'reaplica a matemática atual ignorando a histerese', false)
  .option('--dry-run', 'calcula e mostra, sem escrever no banco', false)
  .option('--as-of <data>', 'instante de referência (ISO). Default: agora', isoDate)
  .parse();

const options = program.opts<{
  fullRecompute: boolean;
  dryRun: boolean;
  asOf?: Date;
}>();

try {
  const summary = await classify({
    ...(options.asOf ? { now: options.asOf } : {}),
    fullRecompute: options.fullRecompute,
    dryRun: options.dryRun,
  });

  const byLevel = new Map<EngagementLevel, typeof summary.members>();
  for (const member of summary.members) {
    byLevel.set(member.level, [...(byLevel.get(member.level) ?? []), member]);
  }

  process.stdout.write(
    `\npesos ${summary.weightsVersion} | ${summary.members.length} membros | ` +
      `referência p90: cons=${summary.references.consumption.toFixed(1)} ` +
      `prod=${summary.references.production.toFixed(1)} ` +
      `recip=${summary.references.reciprocity.toFixed(1)} ` +
      `infl=${summary.references.influence.toFixed(1)}\n\n`,
  );

  process.stdout.write('LEVEL  NOME          MEMBROS  SCORE MÉDIO\n');
  for (const level of [1, 2, 3, 4, 5] as EngagementLevel[]) {
    const rows = byLevel.get(level) ?? [];
    if (rows.length === 0) continue;
    const average = rows.reduce((sum, row) => sum + row.score30d, 0) / rows.length;
    process.stdout.write(
      `${String(level).padEnd(7)}${levelName(level).padEnd(14)}${String(rows.length).padEnd(9)}${average.toFixed(1)}\n`,
    );
  }

  const changed = summary.members.filter((member) => member.changed);
  if (changed.length > 0) {
    process.stdout.write('\nTRANSIÇÕES\n');
    for (const member of changed) {
      process.stdout.write(
        `  ${member.memberHash.slice(0, 8)}  ${member.previousLevel ?? '—'} → ${member.level}  (${member.reason})\n`,
      );
    }
  }

  if (summary.demotionsHeld > 0) {
    process.stdout.write(
      `\n${summary.demotionsHeld} rebaixamento(s) segurado(s) pela histerese de 14 dias\n`,
    );
  }

  process.stdout.write(
    summary.dryRun ? '\n[dry-run] nada foi escrito no banco\n\n' : `\n${summary.transitions} transição(ões) gravada(s)\n\n`,
  );
} catch (error) {
  logger.error({ err: error }, 'classify falhou');
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
