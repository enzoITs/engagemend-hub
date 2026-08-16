import type { EventType } from '../types/scoring.js';
import { DAILY_CAPS, HALF_LIFE_DAYS, SCORE_WINDOW_DAYS, weightOf } from './weights.js';

/**
 * Janela móvel e decaimento (§8).
 *
 * Sem decay o score acumulado cresce para sempre e trava o membro num nível que
 * ele já não ocupa — a engine perde a capacidade de rebaixar, e rebaixamento é
 * metade do sinal.
 *
 * Puro: `now` sempre entra por parâmetro, nunca por `Date.now()`. É o que faz
 * `--full-recompute` ser reproduzível.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function ageInDays(occurredAt: Date, now: Date): number {
  return (now.getTime() - occurredAt.getTime()) / MS_PER_DAY;
}

/** `peso_base * 0.5 ^ (dias / meia-vida)`. Evento no futuro não ganha bônus. */
export function effectiveWeight(
  baseWeight: number,
  ageDays: number,
  halfLifeDays: number = HALF_LIFE_DAYS,
): number {
  const age = Math.max(0, ageDays);
  return baseWeight * Math.pow(0.5, age / halfLifeDays);
}

export function isWithinScoreWindow(
  occurredAt: Date,
  now: Date,
  windowDays: number = SCORE_WINDOW_DAYS,
): boolean {
  const age = ageInDays(occurredAt, now);
  return age <= windowDays;
}

export interface DecayableEvent {
  eventType: EventType;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Multiplicador de qualidade (0–1, ex: `quality_score` do Groq no YouTube).
 * Ausente/inválido = 1.0 — evento Discord não muda em nada. Um comentário
 * `spam_irrelevante` entra com 0: fica gravado (append-only) mas não pontua.
 */
export function qualityMultiplierOf(event: DecayableEvent): number {
  const raw = event.metadata?.qualityMultiplier;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
}

/** Chave de dia em UTC. Fuso do servidor não pode mudar o resultado do recompute. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Aplica os tetos diários (§7): por membro, por tipo, por dia UTC, sobram os N
 * primeiros em ordem cronológica. Determinístico — mesma entrada, mesmo corte.
 *
 * Vale para `score30d` e para `scoreLifetime`: um teto que só protege a janela
 * curta deixa o histórico inflado pelo mesmo spam.
 */
export function applyDailyCaps<T extends DecayableEvent>(
  events: readonly T[],
  caps: Partial<Record<EventType, number>> = DAILY_CAPS,
): T[] {
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const seen = new Map<string, number>();
  const kept: T[] = [];

  for (const event of ordered) {
    const cap = caps[event.eventType];
    if (cap === undefined) {
      kept.push(event);
      continue;
    }

    const key = `${event.eventType}:${utcDayKey(event.occurredAt)}`;
    const used = seen.get(key) ?? 0;
    if (used >= cap) continue;

    seen.set(key, used + 1);
    kept.push(event);
  }

  return kept;
}

/** Soma decaída dentro da janela. É o `score30d`. */
export function decayedScore(
  events: readonly DecayableEvent[],
  now: Date,
  windowDays: number = SCORE_WINDOW_DAYS,
): number {
  let total = 0;
  for (const event of events) {
    if (!isWithinScoreWindow(event.occurredAt, now, windowDays)) continue;
    const baseWeight = weightOf(event.eventType) * qualityMultiplierOf(event);
    total += effectiveWeight(baseWeight, ageInDays(event.occurredAt, now));
  }
  return total;
}

/** Soma crua, sem decay e sem janela. É o `scoreLifetime`. */
export function lifetimeScore(events: readonly DecayableEvent[]): number {
  let total = 0;
  for (const event of events) total += weightOf(event.eventType) * qualityMultiplierOf(event);
  return total;
}
