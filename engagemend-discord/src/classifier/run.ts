import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import type { EngagementLevel, EventType } from '../types/scoring.js';
import {
  aggregateMember,
  axisReferences,
  normalizeAxes,
  type AxisTotals,
  type MemberAggregate,
  type MemberEventRow,
} from './axes.js';
import { applyDailyCaps } from './decay.js';
import { decideLevel, naturalLevel, type TransitionReason } from './level.js';
import { HYSTERESIS_DAYS, WEIGHTS_VERSION } from './weights.js';

/**
 * Orquestração: lê `member_events`, grava `member_profiles` e `level_transitions`.
 *
 * O classificador NUNCA chama a API do Discord (§1.1) e NUNCA escreve em
 * `member_events` (§1.3). Ele lê o event store e deriva. Por isso rodar de novo
 * com pesos novos custa um comando e nenhuma coleta.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ClassifyOptions {
  /** Instante de referência. Parametrizado para o recompute ser reproduzível. */
  now?: Date;
  fullRecompute?: boolean;
  dryRun?: boolean;
}

export interface MemberOutcome {
  memberHash: string;
  level: EngagementLevel;
  previousLevel: EngagementLevel | null;
  score30d: number;
  scoreLifetime: number;
  axes: AxisTotals;
  changed: boolean;
  reason: TransitionReason | null;
  demotionHeld: boolean;
}

export interface ClassifySummary {
  computedAt: Date;
  weightsVersion: string;
  members: MemberOutcome[];
  references: AxisTotals;
  transitions: number;
  demotionsHeld: number;
  dryRun: boolean;
}

interface StoredEventRow {
  memberHash: string;
  eventType: string;
  occurredAt: Date;
  metadata: unknown;
}

async function loadEvents(): Promise<Map<string, MemberEventRow[]>> {
  const rows: StoredEventRow[] = await prisma.memberEvent.findMany({
    select: { memberHash: true, eventType: true, occurredAt: true, metadata: true },
    orderBy: { occurredAt: 'asc' },
  });

  const byMember = new Map<string, MemberEventRow[]>();
  for (const row of rows) {
    const list = byMember.get(row.memberHash) ?? [];
    list.push({
      memberHash: row.memberHash,
      eventType: row.eventType as EventType,
      occurredAt: row.occurredAt,
      metadata: (row.metadata ?? undefined) as Record<string, unknown> | undefined,
    });
    byMember.set(row.memberHash, list);
  }
  return byMember;
}

/**
 * Nível natural de cada membro em cada um dos últimos `HYSTERESIS_DAYS` dias.
 *
 * Recalcula a comunidade inteira em cada corte porque a normalização dos eixos
 * é relativa ao p90 daquele dia — usar o p90 de hoje para julgar 13 dias atrás
 * inventaria histórico.
 */
function naturalLevelSeries(
  capped: Map<string, MemberEventRow[]>,
  now: Date,
): Map<string, EngagementLevel[]> {
  const series = new Map<string, EngagementLevel[]>();

  for (let offset = HYSTERESIS_DAYS - 1; offset >= 0; offset -= 1) {
    const asOf = new Date(now.getTime() - offset * MS_PER_DAY);

    const aggregates: MemberAggregate[] = [];
    for (const [memberHash, events] of capped) {
      // Evento posterior ao corte não pode contar para o passado.
      const upToThen = events.filter((event) => event.occurredAt <= asOf);
      aggregates.push(aggregateMember(memberHash, upToThen, asOf));
    }

    const references = axisReferences(aggregates);
    for (const aggregate of aggregates) {
      const axes = normalizeAxes(aggregate.axesRaw, references);
      const level = naturalLevel(aggregate.score30d, axes);
      const list = series.get(aggregate.memberHash) ?? [];
      list.push(level);
      series.set(aggregate.memberHash, list);
    }
  }

  return series;
}

export async function classify(options: ClassifyOptions = {}): Promise<ClassifySummary> {
  const now = options.now ?? new Date();
  const fullRecompute = options.fullRecompute ?? false;
  const dryRun = options.dryRun ?? false;

  const byMember = await loadEvents();
  const capped = new Map<string, MemberEventRow[]>();
  for (const [memberHash, events] of byMember) {
    capped.set(memberHash, applyDailyCaps(events));
  }

  logger.info(
    { membros: capped.size, weightsVersion: WEIGHTS_VERSION, fullRecompute, dryRun },
    'classificando',
  );

  const aggregates = [...capped.entries()].map(([memberHash, events]) =>
    aggregateMember(memberHash, events, now),
  );
  const references = axisReferences(aggregates);
  const series = naturalLevelSeries(capped, now);
  const communityByHash = new Map<string, string>();
  const communityRows = await prisma.memberEvent.findMany({ where: { memberHash: { in: aggregates.map((a) => a.memberHash) }, communityId: { not: null } }, distinct: ['memberHash'], select: { memberHash: true, communityId: true } });
  for (const row of communityRows) if (row.communityId) communityByHash.set(row.memberHash, row.communityId);

  const profiles = await prisma.memberProfile.findMany({
    select: { memberHash: true, currentLevel: true, levelSince: true },
  });
  const existing = new Map(profiles.map((profile) => [profile.memberHash, profile]));

  const members: MemberOutcome[] = [];
  let transitions = 0;
  let demotionsHeld = 0;

  for (const aggregate of aggregates) {
    const axes = normalizeAxes(aggregate.axesRaw, references);
    const natural = naturalLevel(aggregate.score30d, axes);
    const previous = existing.get(aggregate.memberHash);
    const current = (previous?.currentLevel as EngagementLevel | undefined) ?? null;

    const decision = decideLevel({
      natural,
      current,
      recentNatural: series.get(aggregate.memberHash) ?? [],
      fullRecompute,
    });

    if (decision.demotionHeld) demotionsHeld += 1;
    if (decision.changed) transitions += 1;

    members.push({
      memberHash: aggregate.memberHash,
      level: decision.level,
      previousLevel: current,
      score30d: aggregate.score30d,
      scoreLifetime: aggregate.scoreLifetime,
      axes,
      changed: decision.changed,
      reason: decision.reason,
      demotionHeld: decision.demotionHeld,
    });

    if (dryRun) continue;

    await prisma.memberProfile.upsert({
      where: { memberHash: aggregate.memberHash },
      create: {
        memberHash: aggregate.memberHash,
        currentLevel: decision.level,
        score30d: aggregate.score30d,
        scoreLifetime: aggregate.scoreLifetime,
        levelSince: now,
        firstActivityAt: aggregate.firstActivityAt,
        lastActivityAt: aggregate.lastActivityAt,
        axisConsumption: axes.consumption,
        axisProduction: axes.production,
        axisReciprocity: axes.reciprocity,
        axisInfluence: axes.influence,
        computedAt: now,
        weightsVersion: WEIGHTS_VERSION,
      },
      update: {
        currentLevel: decision.level,
        score30d: aggregate.score30d,
        scoreLifetime: aggregate.scoreLifetime,
        // `levelSince` só se mexe quando o nível muda de verdade.
        ...(decision.changed ? { levelSince: now } : {}),
        firstActivityAt: aggregate.firstActivityAt,
        lastActivityAt: aggregate.lastActivityAt,
        axisConsumption: axes.consumption,
        axisProduction: axes.production,
        axisReciprocity: axes.reciprocity,
        axisInfluence: axes.influence,
        computedAt: now,
        weightsVersion: WEIGHTS_VERSION,
      },
    });

    if (decision.changed && decision.reason) {
      // O que a M2 consome é a transição, não o nível (§6).
      await prisma.levelTransition.create({
        data: {
          memberHash: aggregate.memberHash,
          communityId: communityByHash.get(aggregate.memberHash) ?? null,
          fromLevel: current,
          toLevel: decision.level,
          scoreAt: aggregate.score30d,
          reason: decision.reason,
          occurredAt: now,
        },
      });
    }
  }

  members.sort((a, b) => b.score30d - a.score30d);

  return {
    computedAt: now,
    weightsVersion: WEIGHTS_VERSION,
    members,
    references,
    transitions,
    demotionsHeld,
    dryRun,
  };
}
