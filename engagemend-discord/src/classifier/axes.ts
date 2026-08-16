import type { EventType } from '../types/scoring.js';
import {
  ageInDays,
  decayedScore,
  effectiveWeight,
  isWithinScoreWindow,
  lifetimeScore,
  qualityMultiplierOf,
  type DecayableEvent,
} from './decay.js';
import {
  AXES,
  AXIS_NORMALIZATION_PERCENTILE,
  SCORE_WINDOW_DAYS,
  axisOf,
  weightOf,
  type EngagementAxis,
} from './weights.js';

/**
 * Agregação nos quatro eixos (§8).
 *
 * O eixo cru é a soma dos pesos efetivos daquele eixo. A normalização 0–100 usa
 * o percentil 90 da comunidade e não o máximo: um outlier achataria todo mundo.
 */

export type AxisTotals = Record<EngagementAxis, number>;

export function emptyAxes(): AxisTotals {
  return { consumption: 0, production: 0, reciprocity: 0, influence: 0 };
}

export interface MemberEventRow extends DecayableEvent {
  memberHash: string;
  eventType: EventType;
  occurredAt: Date;
}

export interface MemberAggregate {
  memberHash: string;
  score30d: number;
  scoreLifetime: number;
  /** Somas cruas por eixo, antes de normalizar. */
  axesRaw: AxisTotals;
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
  eventCount: number;
}

/** Espera eventos JÁ filtrados pelos tetos diários. */
export function aggregateMember(
  memberHash: string,
  events: readonly MemberEventRow[],
  now: Date,
  windowDays: number = SCORE_WINDOW_DAYS,
): MemberAggregate {
  const axesRaw = emptyAxes();
  let firstActivityAt: Date | null = null;
  let lastActivityAt: Date | null = null;

  for (const event of events) {
    if (!firstActivityAt || event.occurredAt < firstActivityAt) firstActivityAt = event.occurredAt;
    if (!lastActivityAt || event.occurredAt > lastActivityAt) lastActivityAt = event.occurredAt;

    if (!isWithinScoreWindow(event.occurredAt, now, windowDays)) continue;
    const effective = effectiveWeight(
      weightOf(event.eventType) * qualityMultiplierOf(event),
      ageInDays(event.occurredAt, now),
    );
    axesRaw[axisOf(event.eventType)] += effective;
  }

  return {
    memberHash,
    score30d: decayedScore(events, now, windowDays),
    scoreLifetime: lifetimeScore(events),
    axesRaw,
    firstActivityAt,
    lastActivityAt,
    eventCount: events.length,
  };
}

/**
 * Percentil por rank mais próximo sobre a lista ordenada.
 * `percentile([...], 0.9)` num conjunto de 10 devolve o 9º valor.
 */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

/**
 * Referência de normalização: o percentil 90 de cada eixo na comunidade.
 * Membros sem atividade naquele eixo entram na distribuição como zero — são
 * parte da comunidade, e tirá-los inflaria a régua.
 */
export function axisReferences(
  aggregates: readonly MemberAggregate[],
  fraction: number = AXIS_NORMALIZATION_PERCENTILE,
): AxisTotals {
  const reference = emptyAxes();
  for (const axis of AXES) {
    reference[axis] = percentile(
      aggregates.map((aggregate) => aggregate.axesRaw[axis]),
      fraction,
    );
  }
  return reference;
}

/** 0–100, com teto em 100 — quem está acima do p90 satura. */
export function normalizeAxes(raw: AxisTotals, reference: AxisTotals): AxisTotals {
  const normalized = emptyAxes();
  for (const axis of AXES) {
    const ref = reference[axis];
    normalized[axis] = ref > 0 ? Math.min(100, (raw[axis] / ref) * 100) : 0;
  }
  return normalized;
}
