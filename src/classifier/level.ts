import type { EngagementLevel } from '../types/scoring.js';
import type { AxisTotals } from './axes.js';
import { HYSTERESIS_DAYS, LEVEL_NAMES, LEVEL_THRESHOLDS } from './weights.js';

/**
 * Score + eixos → nível (§8).
 *
 * `score` é a soma crua dos pesos decaídos (o `score30d`), não normalizada.
 * Só os EIXOS são normalizados 0–100 pelo p90 — eles são a porta, o score é o
 * volume. Nível passa a significar a mesma coisa independente de quem mais
 * está no servidor, e o rebaixamento depende da trajetória do próprio membro
 * e não de outra pessoa ter ficado mais ativa.
 */

export type TransitionReason = 'initial' | 'promotion' | 'demotion' | 'recompute';

/**
 * Nível que score e eixos implicam HOJE, ignorando histerese.
 *
 * A porta de eixo existe porque quem manda 300 mensagens e ninguém responde
 * não é Contribuinte — é ruído (§8).
 */
export function naturalLevel(score: number, axes: AxisTotals): EngagementLevel {
  for (const threshold of LEVEL_THRESHOLDS) {
    if (score < threshold.minScore) continue;
    if (threshold.gate && axes[threshold.gate.axis] < threshold.gate.min) continue;
    return threshold.level;
  }
  return 1;
}

export function levelName(level: EngagementLevel): string {
  return LEVEL_NAMES[level];
}

export interface LevelDecisionInput {
  natural: EngagementLevel;
  /** Nível gravado no perfil. `null` quando o membro nunca foi classificado. */
  current: EngagementLevel | null;
  /**
   * Nível natural em cada um dos últimos `HYSTERESIS_DAYS` dias, do mais antigo
   * para o mais recente, incluindo hoje. Vem do event store, não de estado
   * salvo — é isso que faz `--full-recompute` ser reproduzível.
   */
  recentNatural: readonly EngagementLevel[];
  /**
   * Quando os pesos mudaram, o nível anterior não é base de comparação válida:
   * aplica-se a matemática nova direto, sem segurar por histerese.
   */
  fullRecompute?: boolean;
}

export interface LevelDecision {
  level: EngagementLevel;
  changed: boolean;
  reason: TransitionReason | null;
  /** `true` quando a queda foi segurada pela histerese. */
  demotionHeld: boolean;
}

export function decideLevel(input: LevelDecisionInput): LevelDecision {
  const { natural, current, recentNatural, fullRecompute = false } = input;

  if (current === null) {
    return { level: natural, changed: true, reason: 'initial', demotionHeld: false };
  }

  if (natural === current) {
    return { level: current, changed: false, reason: null, demotionHeld: false };
  }

  if (fullRecompute) {
    return { level: natural, changed: true, reason: 'recompute', demotionHeld: false };
  }

  if (natural > current) {
    // Promoção é imediata: subir é sinal, não ruído.
    return { level: natural, changed: true, reason: 'promotion', demotionHeld: false };
  }

  // Rebaixar exige o score abaixo do limiar por HYSTERESIS_DAYS dias seguidos.
  // Sem isso o membro oscila toda semana e o dado da M2 vira serrilhado inútil.
  const enoughHistory = recentNatural.length >= HYSTERESIS_DAYS;
  const belowThroughout = recentNatural.every((level) => level < current);

  if (enoughHistory && belowThroughout) {
    return { level: natural, changed: true, reason: 'demotion', demotionHeld: false };
  }

  return { level: current, changed: false, reason: null, demotionHeld: true };
}
