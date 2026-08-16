import { describe, expect, it } from 'vitest';

import {
  ageInDays,
  applyDailyCaps,
  decayedScore,
  effectiveWeight,
  isWithinScoreWindow,
  lifetimeScore,
  qualityMultiplierOf,
  utcDayKey,
  type DecayableEvent,
} from '../src/classifier/decay.js';
import { HALF_LIFE_DAYS, SCORE_WINDOW_DAYS } from '../src/classifier/weights.js';
import type { EventType } from '../src/types/scoring.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

const event = (eventType: EventType, days: number): DecayableEvent => ({
  eventType,
  occurredAt: daysAgo(days),
});

describe('ageInDays', () => {
  it('conta em dias fracionários', () => {
    expect(ageInDays(daysAgo(1), NOW)).toBe(1);
    expect(ageInDays(daysAgo(0.5), NOW)).toBe(0.5);
    expect(ageInDays(NOW, NOW)).toBe(0);
  });

  it('fica negativo para evento no futuro', () => {
    expect(ageInDays(new Date(NOW.getTime() + DAY), NOW)).toBe(-1);
  });
});

describe('effectiveWeight', () => {
  it('não decai no instante do evento', () => {
    expect(effectiveWeight(10, 0)).toBe(10);
  });

  it('cai pela metade a cada meia-vida', () => {
    expect(effectiveWeight(10, HALF_LIFE_DAYS)).toBeCloseTo(5, 10);
    expect(effectiveWeight(10, HALF_LIFE_DAYS * 2)).toBeCloseTo(2.5, 10);
    expect(effectiveWeight(10, HALF_LIFE_DAYS * 3)).toBeCloseTo(1.25, 10);
  });

  it('evento no futuro não ganha bônus — vale o peso cheio, não mais', () => {
    expect(effectiveWeight(10, -30)).toBe(10);
  });

  it('respeita meia-vida customizada', () => {
    expect(effectiveWeight(8, 7, 7)).toBeCloseTo(4, 10);
  });
});

describe('isWithinScoreWindow', () => {
  it('inclui o limite exato de 60 dias e exclui além dele', () => {
    expect(isWithinScoreWindow(daysAgo(SCORE_WINDOW_DAYS), NOW)).toBe(true);
    expect(isWithinScoreWindow(daysAgo(SCORE_WINDOW_DAYS + 0.001), NOW)).toBe(false);
  });

  it('inclui evento de hoje', () => {
    expect(isWithinScoreWindow(NOW, NOW)).toBe(true);
  });
});

describe('utcDayKey', () => {
  it('agrupa por dia UTC, não pelo fuso da máquina', () => {
    expect(utcDayKey(new Date('2026-08-08T23:59:59.000Z'))).toBe('2026-08-08');
    expect(utcDayKey(new Date('2026-08-09T00:00:01.000Z'))).toBe('2026-08-09');
  });
});

describe('applyDailyCaps', () => {
  it('corta reaction_given em 15 por dia', () => {
    const events = Array.from({ length: 40 }, (_, index) => ({
      eventType: 'reaction_given' as EventType,
      occurredAt: new Date(`2026-08-08T${String(index % 24).padStart(2, '0')}:00:00.000Z`),
    }));

    const kept = applyDailyCaps(events);
    expect(kept).toHaveLength(15);
  });

  it('o teto reinicia a cada dia UTC', () => {
    const events = [
      ...Array.from({ length: 20 }, (_, i) => ({
        eventType: 'reaction_given' as EventType,
        occurredAt: new Date(`2026-08-08T${String(i % 24).padStart(2, '0')}:00:00.000Z`),
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        eventType: 'reaction_given' as EventType,
        occurredAt: new Date(`2026-08-09T${String(i % 24).padStart(2, '0')}:00:00.000Z`),
      })),
    ];

    expect(applyDailyCaps(events)).toHaveLength(30);
  });

  it('mantém os mais antigos do dia — corte determinístico', () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      eventType: 'message_sent' as EventType,
      occurredAt: new Date(`2026-08-08T00:${String(index).padStart(2, '0')}:00.000Z`),
      tag: index,
    }));

    const kept = applyDailyCaps(events);
    expect(kept).toHaveLength(20); // teto de message_sent é 30
    expect(kept.map((e) => e.tag)).toEqual(events.map((e) => e.tag));
  });

  it('tipo sem teto passa inteiro', () => {
    const events = Array.from({ length: 50 }, () => event('reaction_received', 0));
    expect(applyDailyCaps(events)).toHaveLength(50);
  });

  it('tetos de tipos diferentes não se misturam', () => {
    const events = [
      ...Array.from({ length: 20 }, () => event('reaction_given', 0)),
      ...Array.from({ length: 20 }, () => event('reply_given', 0)),
    ];
    const kept = applyDailyCaps(events);
    expect(kept.filter((e) => e.eventType === 'reaction_given')).toHaveLength(15);
    expect(kept.filter((e) => e.eventType === 'reply_given')).toHaveLength(20);
  });

  it('é determinístico: mesma entrada em ordem embaralhada, mesmo corte', () => {
    const events = Array.from({ length: 25 }, (_, index) => ({
      eventType: 'reaction_given' as EventType,
      occurredAt: new Date(`2026-08-08T00:${String(index).padStart(2, '0')}:00.000Z`),
    }));

    const straight = applyDailyCaps(events).map((e) => e.occurredAt.toISOString());
    const shuffled = applyDailyCaps([...events].reverse()).map((e) => e.occurredAt.toISOString());
    expect(shuffled).toEqual(straight);
  });
});

describe('decayedScore', () => {
  it('soma o peso cheio de eventos de hoje', () => {
    // message_sent = 2, media_posted = 5
    expect(decayedScore([event('message_sent', 0), event('media_posted', 0)], NOW)).toBeCloseTo(
      7,
      10,
    );
  });

  it('aplica meia-vida de 14 dias', () => {
    expect(decayedScore([event('media_posted', HALF_LIFE_DAYS)], NOW)).toBeCloseTo(2.5, 10);
  });

  it('ignora evento além da janela de 60 dias', () => {
    expect(decayedScore([event('forum_solution', 61)], NOW)).toBe(0);
    expect(decayedScore([event('forum_solution', 59)], NOW)).toBeGreaterThan(0);
  });

  it('sem decay o score nunca cairia — é o que permite rebaixar', () => {
    const recente = decayedScore([event('message_sent', 0)], NOW);
    const antigo = decayedScore([event('message_sent', 42)], NOW);
    expect(antigo).toBeLessThan(recente / 4);
  });
});

describe('lifetimeScore', () => {
  it('soma peso cru, sem decay', () => {
    expect(lifetimeScore([event('message_sent', 0), event('message_sent', 900)])).toBe(4);
  });

  it('não tem janela — evento de anos atrás continua contando', () => {
    expect(lifetimeScore([event('invite_used', 3000)])).toBe(20);
  });

  it('vazio é zero', () => {
    expect(lifetimeScore([])).toBe(0);
  });
});

describe('qualityMultiplierOf', () => {
  it('default 1.0 quando metadata ausente — evento Discord não muda em nada', () => {
    expect(qualityMultiplierOf(event('message_sent', 0))).toBe(1);
  });

  it('lê metadata.qualityMultiplier quando presente', () => {
    const withQuality: DecayableEvent = { ...event('comment_sent', 0), metadata: { qualityMultiplier: 0.4 } };
    expect(qualityMultiplierOf(withQuality)).toBe(0.4);
  });

  it('spam_irrelevante (multiplier 0) zera o evento sem descartá-lo', () => {
    const spam: DecayableEvent = { ...event('comment_sent', 0), metadata: { qualityMultiplier: 0 } };
    expect(decayedScore([spam], NOW)).toBe(0);
    expect(lifetimeScore([spam])).toBe(0);
  });

  it('multiplica o peso efetivo em decayedScore e lifetimeScore', () => {
    const meia: DecayableEvent = { ...event('comment_substantial', 0), metadata: { qualityMultiplier: 0.5 } };
    expect(decayedScore([meia], NOW)).toBeCloseTo(1.5, 10);
    expect(lifetimeScore([meia])).toBeCloseTo(1.5, 10);
  });

  it('valor não numérico ou ausente cai pro default 1.0', () => {
    const invalido: DecayableEvent = { ...event('comment_sent', 0), metadata: { qualityMultiplier: 'alta' } };
    expect(qualityMultiplierOf(invalido)).toBe(1);
  });
});
