import { describe, expect, it } from 'vitest';

import {
  aggregateMember,
  axisReferences,
  emptyAxes,
  normalizeAxes,
  percentile,
  type AxisTotals,
  type MemberEventRow,
} from '../src/classifier/axes.js';
import { decideLevel, levelName, naturalLevel } from '../src/classifier/level.js';
import { HYSTERESIS_DAYS } from '../src/classifier/weights.js';
import type { EngagementLevel, EventType } from '../src/types/scoring.js';

const axes = (overrides: Partial<AxisTotals> = {}): AxisTotals => ({
  ...emptyAxes(),
  ...overrides,
});

const NOW = new Date('2026-08-08T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const row = (eventType: EventType, daysAgo: number, memberHash = 'm1'): MemberEventRow => ({
  memberHash,
  eventType,
  occurredAt: new Date(NOW.getTime() - daysAgo * DAY),
});

// ── Nível natural ───────────────────────────────────────────────────────────

describe('naturalLevel', () => {
  it('sem atividade é Observador', () => {
    expect(naturalLevel(0, axes())).toBe(1);
  });

  it('score 8 promove a Participante; 7.9 não', () => {
    expect(naturalLevel(8, axes())).toBe(2);
    expect(naturalLevel(7.9, axes())).toBe(1);
  });

  it('Contribuinte exige score 30 E reciprocidade 20', () => {
    expect(naturalLevel(30, axes({ reciprocity: 20 }))).toBe(3);
    expect(naturalLevel(30, axes({ reciprocity: 19.9 }))).toBe(2);
    expect(naturalLevel(29.9, axes({ reciprocity: 100 }))).toBe(2);
  });

  it('Líder exige score 55 E influência 35', () => {
    expect(naturalLevel(55, axes({ influence: 35 }))).toBe(4);
    expect(naturalLevel(55, axes({ influence: 34.9, reciprocity: 100 }))).toBe(3);
  });

  it('Embaixador exige score 80 E influência 60', () => {
    expect(naturalLevel(80, axes({ influence: 60 }))).toBe(5);
    expect(naturalLevel(80, axes({ influence: 59.9 }))).toBe(4);
  });

  it('volume sem sinal recebido não promove — quem grita sozinho é ruído', () => {
    // 300 mensagens, ninguém responde, ninguém reage
    expect(naturalLevel(600, axes({ production: 100 }))).toBe(2);
  });

  it('a porta de eixo derruba para o primeiro nível que ele alcança', () => {
    // score de Embaixador, mas influência só de Líder
    expect(naturalLevel(120, axes({ influence: 40, reciprocity: 90 }))).toBe(4);
    // score de Embaixador, influência de ninguém, reciprocidade alta
    expect(naturalLevel(120, axes({ influence: 0, reciprocity: 90 }))).toBe(3);
  });

  it('nomes batem com o §0', () => {
    expect([1, 2, 3, 4, 5].map((l) => levelName(l as EngagementLevel))).toEqual([
      'Observador',
      'Participante',
      'Contribuinte',
      'Líder',
      'Embaixador',
    ]);
  });
});

// ── Histerese ───────────────────────────────────────────────────────────────

describe('decideLevel', () => {
  const below = (level: EngagementLevel, days = HYSTERESIS_DAYS): EngagementLevel[] =>
    Array.from({ length: days }, () => level);

  it('primeira classificação é initial', () => {
    const decision = decideLevel({ natural: 3, current: null, recentNatural: [3] });
    expect(decision).toEqual({ level: 3, changed: true, reason: 'initial', demotionHeld: false });
  });

  it('promoção é imediata, sem esperar 14 dias', () => {
    const decision = decideLevel({ natural: 4, current: 2, recentNatural: [2, 2, 4] });
    expect(decision.level).toBe(4);
    expect(decision.reason).toBe('promotion');
  });

  it('nível igual não gera transição', () => {
    const decision = decideLevel({ natural: 3, current: 3, recentNatural: below(3) });
    expect(decision).toEqual({ level: 3, changed: false, reason: null, demotionHeld: false });
  });

  it('rebaixamento exige 14 dias consecutivos abaixo', () => {
    const decision = decideLevel({ natural: 2, current: 3, recentNatural: below(2) });
    expect(decision.level).toBe(2);
    expect(decision.reason).toBe('demotion');
  });

  it('13 dias abaixo ainda segura o nível', () => {
    const decision = decideLevel({
      natural: 2,
      current: 3,
      recentNatural: below(2, HYSTERESIS_DAYS - 1),
    });
    expect(decision.level).toBe(3);
    expect(decision.changed).toBe(false);
    expect(decision.demotionHeld).toBe(true);
  });

  it('um único dia de volta ao nível zera a contagem', () => {
    const serie = below(2);
    serie[5] = 3; // voltou a Contribuinte no meio da janela
    const decision = decideLevel({ natural: 2, current: 3, recentNatural: serie });
    expect(decision.level).toBe(3);
    expect(decision.demotionHeld).toBe(true);
  });

  it('membro novo demais para ter 14 dias de série não é rebaixado', () => {
    const decision = decideLevel({ natural: 1, current: 3, recentNatural: [1, 1, 1] });
    expect(decision.level).toBe(3);
    expect(decision.demotionHeld).toBe(true);
  });

  it('--full-recompute aplica a matemática nova direto, sem histerese', () => {
    const decision = decideLevel({
      natural: 1,
      current: 5,
      recentNatural: [5, 5, 5],
      fullRecompute: true,
    });
    expect(decision.level).toBe(1);
    expect(decision.reason).toBe('recompute');
  });

  it('--full-recompute não inventa transição quando o nível não mudou', () => {
    const decision = decideLevel({
      natural: 3,
      current: 3,
      recentNatural: [],
      fullRecompute: true,
    });
    expect(decision.changed).toBe(false);
  });
});

// ── Eixos ───────────────────────────────────────────────────────────────────

describe('percentile', () => {
  it('p90 de 10 valores é o nono', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });

  it('não se deixa levar por um outlier', () => {
    expect(percentile([1, 1, 1, 1, 1, 1, 1, 1, 1, 9999], 0.9)).toBe(1);
  });

  it('ordena antes de cortar', () => {
    expect(percentile([10, 1, 5, 3, 8], 0.9)).toBe(10);
  });

  it('lista vazia é zero', () => {
    expect(percentile([], 0.9)).toBe(0);
  });
});

describe('normalizeAxes', () => {
  it('quem está no p90 vale 100', () => {
    const result = normalizeAxes(axes({ influence: 50 }), axes({ influence: 50 }));
    expect(result.influence).toBe(100);
  });

  it('quem está acima do p90 satura em 100', () => {
    const result = normalizeAxes(axes({ influence: 500 }), axes({ influence: 50 }));
    expect(result.influence).toBe(100);
  });

  it('escala linear abaixo do p90', () => {
    const result = normalizeAxes(axes({ production: 25 }), axes({ production: 50 }));
    expect(result.production).toBe(50);
  });

  it('referência zero não divide por zero', () => {
    const result = normalizeAxes(axes({ reciprocity: 10 }), emptyAxes());
    expect(result.reciprocity).toBe(0);
  });
});

describe('aggregateMember', () => {
  it('separa os pesos nos eixos certos', () => {
    const aggregate = aggregateMember(
      'm1',
      [row('message_sent', 0), row('reply_given', 0), row('reaction_received', 0), row('reaction_given', 0)],
      NOW,
    );

    expect(aggregate.axesRaw.production).toBeCloseTo(2, 10);
    expect(aggregate.axesRaw.reciprocity).toBeCloseTo(4, 10);
    expect(aggregate.axesRaw.influence).toBeCloseTo(3, 10);
    expect(aggregate.axesRaw.consumption).toBeCloseTo(1, 10);
  });

  it('eixo respeita a janela de 60 dias, lifetime não', () => {
    const aggregate = aggregateMember('m1', [row('forum_solution', 90)], NOW);
    expect(aggregate.axesRaw.influence).toBe(0);
    expect(aggregate.score30d).toBe(0);
    expect(aggregate.scoreLifetime).toBe(12);
  });

  it('registra primeira e última atividade mesmo fora da janela', () => {
    const aggregate = aggregateMember('m1', [row('message_sent', 200), row('message_sent', 1)], NOW);
    expect(aggregate.firstActivityAt?.toISOString()).toBe(
      new Date(NOW.getTime() - 200 * DAY).toISOString(),
    );
    expect(aggregate.lastActivityAt?.toISOString()).toBe(
      new Date(NOW.getTime() - 1 * DAY).toISOString(),
    );
    expect(aggregate.eventCount).toBe(2);
  });

  it('membro sem evento fica zerado, sem NaN', () => {
    const aggregate = aggregateMember('m1', [], NOW);
    expect(aggregate.score30d).toBe(0);
    expect(aggregate.scoreLifetime).toBe(0);
    expect(aggregate.axesRaw).toEqual(emptyAxes());
    expect(aggregate.firstActivityAt).toBeNull();
  });
});

describe('axisReferences', () => {
  it('inclui quem tem zero no eixo — são parte da comunidade', () => {
    const aggregates = [
      aggregateMember('a', [row('reaction_received', 0, 'a')], NOW),
      aggregateMember('b', [], NOW),
      aggregateMember('c', [], NOW),
    ];
    // com 3 membros, p90 cai no maior valor
    expect(axisReferences(aggregates).influence).toBeCloseTo(3, 10);
  });
});
