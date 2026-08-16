import type { EngagementLevel, EventType } from '../types/scoring.js';

/**
 * ARQUIVO ÚNICO DE CALIBRAÇÃO.
 *
 * Tudo aqui é chute calibrável, não verdade (§7). Existe para ser corrigido
 * contra a classificação cega da Frente D. Se a concordância vier abaixo de
 * 80%, o problema está quase sempre neste arquivo — não na engine.
 *
 * Por isso pesos, tetos, decay e limiares moram todos aqui: recalibrar é editar
 * um arquivo, subir `WEIGHTS_VERSION` e rodar `pnpm classify --full-recompute`.
 * O event store não é tocado.
 */

export const WEIGHTS_VERSION = 'v0.1.0-uncalibrated';

export type EngagementAxis = 'consumption' | 'production' | 'reciprocity' | 'influence';

export const AXES: readonly EngagementAxis[] = [
  'consumption',
  'production',
  'reciprocity',
  'influence',
];

export interface WeightEntry {
  weight: number;
  axis: EngagementAxis;
  /** `false` = só existe se o coletor estava no ar (§9). Não tem backfill. */
  retroactive: boolean;
}

export const WEIGHTS: Readonly<Record<EventType, WeightEntry>> = {
  reaction_given: { weight: 1, axis: 'consumption', retroactive: true },
  message_sent: { weight: 2, axis: 'production', retroactive: true },
  message_substantial: { weight: 3, axis: 'production', retroactive: true },
  media_posted: { weight: 5, axis: 'production', retroactive: true },
  reply_given: { weight: 4, axis: 'reciprocity', retroactive: true },
  thread_started: { weight: 6, axis: 'production', retroactive: true },
  thread_replied: { weight: 4, axis: 'reciprocity', retroactive: true },
  reaction_received: { weight: 3, axis: 'influence', retroactive: true },
  reply_received: { weight: 5, axis: 'influence', retroactive: true },
  mention_received: { weight: 4, axis: 'influence', retroactive: true },
  forum_solution: { weight: 12, axis: 'influence', retroactive: true },
  voice_minutes: { weight: 5, axis: 'consumption', retroactive: false },
  newcomer_welcomed: { weight: 8, axis: 'reciprocity', retroactive: true },
  invite_used: { weight: 20, axis: 'influence', retroactive: false },
  // YouTube (peso-base espelha o equivalente Discord; qualidade real vem de
  // `metadata.qualityMultiplier`, ver decay.ts).
  comment_sent: { weight: 2, axis: 'production', retroactive: true },
  comment_substantial: { weight: 3, axis: 'production', retroactive: true },
  comment_reply_received: { weight: 5, axis: 'influence', retroactive: true },
};

/** Sem isso, spam de reação vira Líder (§7). */
export const DAILY_CAPS: Partial<Record<EventType, number>> = {
  reaction_given: 15,
  message_sent: 30,
  reply_given: 25,
};

/** Decaimento exponencial (§8): `peso_efetivo = peso_base * 0.5 ^ (dias / 14)`. */
export const HALF_LIFE_DAYS = 14;

/**
 * Corte duro do `score30d`. O §8 chama a janela de "30 dias" mas define o
 * corte em 60 — 60 é o número operante; os 30 são o nome do campo.
 * Eventos mais velhos continuam no `scoreLifetime` e no event store.
 */
export const SCORE_WINDOW_DAYS = 60;

/**
 * Percentil da comunidade que vira 100 na normalização dos eixos (§8).
 * Máximo achataria todo mundo atrás de um outlier.
 */
export const AXIS_NORMALIZATION_PERCENTILE = 0.9;

/** Dias consecutivos abaixo do limiar antes de rebaixar (§8). */
export const HYSTERESIS_DAYS = 14;

export interface LevelThreshold {
  level: EngagementLevel;
  name: string;
  minScore: number;
  /** Porta de eixo: score sozinho não promove (§8). */
  gate?: { axis: EngagementAxis; min: number };
}

/**
 * Avaliado de cima para baixo — o primeiro que casar vence.
 * Limiares iniciais, recalibrar contra a Frente D.
 */
export const LEVEL_THRESHOLDS: readonly LevelThreshold[] = [
  { level: 5, name: 'Embaixador', minScore: 80, gate: { axis: 'influence', min: 60 } },
  { level: 4, name: 'Líder', minScore: 55, gate: { axis: 'influence', min: 35 } },
  { level: 3, name: 'Contribuinte', minScore: 30, gate: { axis: 'reciprocity', min: 20 } },
  { level: 2, name: 'Participante', minScore: 8 },
  { level: 1, name: 'Observador', minScore: Number.NEGATIVE_INFINITY },
];

export const LEVEL_NAMES: Readonly<Record<EngagementLevel, string>> = {
  1: 'Observador',
  2: 'Participante',
  3: 'Contribuinte',
  4: 'Líder',
  5: 'Embaixador',
};

export function axisOf(eventType: EventType): EngagementAxis {
  return WEIGHTS[eventType].axis;
}

export function weightOf(eventType: EventType): number {
  return WEIGHTS[eventType].weight;
}
