import { describe, expect, it } from 'vitest';

import { scoreBand, scoreLead, scoreLeadRecord, type ScoreInput } from '../src/domain/scoring.js';
import { MS_PER_DAY } from '../src/domain/time.js';
import type { LeadActivity } from '../src/domain/types.js';

const AS_OF = new Date('2026-11-18T15:00:00.000Z');

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    source: 'other',
    stage: 'new',
    urgency: 'low',
    estimatedValueCents: 0,
    hasPhone: false,
    hasEmail: false,
    createdAt: AS_OF.toISOString(),
    lastInteractionAt: null,
    asOf: AS_OF,
    ...overrides,
  };
}

function atAge(days: number): string {
  return new Date(AS_OF.getTime() - Math.round(days * MS_PER_DAY)).toISOString();
}

function points(score: ReturnType<typeof scoreLead>, id: string): number | undefined {
  return score.factors.find((factor) => factor.id === id)?.points;
}

describe('published score examples', () => {
  it('computes an uncapped open lead from the literal point table', () => {
    const score = scoreLead(
      input({
        source: 'other',
        hasPhone: true,
        urgency: 'low',
        estimatedValueCents: 0,
        stage: 'new',
      }),
    );
    expect(score.factors.map((factor) => [factor.id, factor.points])).toEqual([
      ['source', 3],
      ['phone', 10],
      ['urgency', 0],
      ['value', -4],
      ['stage', 4],
      ['recency', 16],
    ]);
    expect(score.score).toBe(29);
    expect(score.band).toBe('cool');
    expect(score.summary).toContain('Cool follow-up priority, 29/100.');
    expect(score.summary).toContain('Last activity was under 2 days ago.');
  });

  it('applies the floor when the raw total is negative', () => {
    const score = scoreLead(input({ createdAt: atAge(30) }));
    expect(points(score, 'source')).toBe(3);
    expect(points(score, 'unreachable')).toBe(-12);
    expect(points(score, 'value')).toBe(-4);
    expect(points(score, 'stage')).toBe(4);
    expect(points(score, 'recency')).toBe(-18);
    expect(points(score, 'floor')).toBe(27);
    expect(score.score).toBe(0);
    expect(score.band).toBe('cold');
    expect(score.summary).toContain('Cold follow-up priority, 0/100.');
  });

  it('caps a hot lost lead at 15 and does not claim a cap when the raw total is already under it', () => {
    const hot = scoreLead(
      input({
        source: 'referral',
        stage: 'lost',
        urgency: 'high',
        estimatedValueCents: 1_800_000,
        hasPhone: true,
        hasEmail: true,
      }),
    );
    expect(hot.factors.map((factor) => [factor.id, factor.points])).toEqual([
      ['source', 22],
      ['phone', 10],
      ['email', 8],
      ['urgency', 20],
      ['value', 16],
      ['recency', 16],
      ['cap', -77],
    ]);
    expect(hot.score).toBe(15);
    expect(hot.summary).toContain('Score capped at 15/100 (cold).');

    const quiet = scoreLead(input({ stage: 'lost' }));
    expect(quiet.score).toBe(3);
    expect(quiet.factors.some((factor) => factor.id === 'cap')).toBe(false);
    expect(quiet.summary).toBe(
      'Lost. Score 3/100 (cold). Closed-lost leads stay out of the chase queue.',
    );
    expect(quiet.summary).not.toContain('capped');
  });

  it('caps a won lead at 40', () => {
    const score = scoreLead(
      input({
        source: 'referral',
        stage: 'won',
        urgency: 'high',
        estimatedValueCents: 500_000,
        hasPhone: true,
        hasEmail: true,
      }),
    );
    expect(score.score).toBe(40);
    expect(points(score, 'cap')).toBe(-52);
    expect(score.summary).toContain('Informational score 40/100');
    expect(score.summary).toContain('not a follow-up priority');
  });

  it('follows the published recency boundaries, exclusive on the under bands', () => {
    const recency = (days: number) =>
      points(scoreLead(input({ hasPhone: true, createdAt: atAge(days) })), 'recency');
    expect(recency(0)).toBe(16);
    expect(recency(2 - 1 / 86_400)).toBe(16);
    expect(recency(2)).toBe(8);
    expect(recency(7 - 1 / 86_400)).toBe(8);
    expect(recency(7)).toBe(0);
    expect(recency(14)).toBe(0);
    expect(recency(14 + 1 / 86_400)).toBe(-12);
    expect(recency(21)).toBe(-12);
    expect(recency(21 + 1 / 86_400)).toBe(-18);
    const atSeven = scoreLead(input({ hasPhone: true, createdAt: atAge(7) }));
    expect(atSeven.factors.find((factor) => factor.id === 'recency')?.detail).toContain(
      '7 days ago',
    );
  });

  it('scores each value tier on its published edge, including a fractional cent', () => {
    const value = (cents: number) =>
      points(scoreLead(input({ hasPhone: true, estimatedValueCents: cents })), 'value');
    expect(value(0)).toBe(-4);
    expect(value(-1)).toBe(-4);
    expect(value(0.5)).toBe(-4);
    expect(value(1)).toBe(4);
    expect(value(39_999)).toBe(4);
    expect(value(40_000)).toBe(8);
    expect(value(149_999)).toBe(8);
    expect(value(150_000)).toBe(12);
    expect(value(499_999)).toBe(12);
    expect(value(500_000)).toBe(16);
  });

  it('names every band on its edge', () => {
    expect(scoreBand(100)).toBe('hot');
    expect(scoreBand(75)).toBe('hot');
    expect(scoreBand(74)).toBe('warm');
    expect(scoreBand(50)).toBe('warm');
    expect(scoreBand(49)).toBe('cool');
    expect(scoreBand(25)).toBe('cool');
    expect(scoreBand(24)).toBe('cold');
    expect(scoreBand(0)).toBe('cold');
  });

  it('breaks a tie for the strongest signal by factor id', () => {
    const score = scoreLead(
      input({
        source: 'phone',
        hasEmail: true,
        urgency: 'low',
        estimatedValueCents: 0,
        stage: 'new',
        createdAt: atAge(10),
      }),
    );
    expect(points(score, 'source')).toBe(8);
    expect(points(score, 'email')).toBe(8);
    expect(score.summary).toContain('An email address is on file.');
  });

  it('reads phone and email presence off the stored lead', () => {
    const lead = {
      id: 'lead_case',
      contactName: 'Case',
      phone: '',
      email: null,
      service: 'Leak',
      source: 'website',
      stage: 'qualified',
      estimatedValueCents: 40_000,
      urgency: 'normal',
      city: null,
      notes: null,
      createdAt: AS_OF.toISOString(),
      updatedAt: AS_OF.toISOString(),
      lastInteractionAt: null,
    } satisfies LeadActivity;
    const scored = scoreLeadRecord(lead, AS_OF);
    expect(scored.factors.some((factor) => factor.id === 'phone')).toBe(false);
    expect(scored.factors.some((factor) => factor.id === 'unreachable')).toBe(true);
    expect(points(scored, 'value')).toBe(8);
    expect(points(scored, 'stage')).toBe(12);
  });
});
