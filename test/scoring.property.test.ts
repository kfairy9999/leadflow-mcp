import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { MS_PER_DAY, MS_PER_HOUR } from '../src/domain/time.js';
import {
  scoreBand,
  scoreLead,
  SCORE_RULES,
  type LeadScore,
  type ScoreInput,
} from '../src/domain/scoring.js';
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  URGENCIES,
  type LeadSource,
  type LeadStage,
} from '../src/domain/types.js';

const AS_OF = new Date('2026-11-18T15:00:00.000Z');
const RUNS = { seed: 20261118, numRuns: 100 } as const;

const sources = [...LEAD_SOURCES] as [LeadSource, ...LeadSource[]];
const stages = [...LEAD_STAGES] as [LeadStage, ...LeadStage[]];
const urgencies = [...URGENCIES] as [(typeof URGENCIES)[number], ...(typeof URGENCIES)[number][]];

function hoursBefore(hours: number): string {
  return new Date(AS_OF.getTime() - hours * MS_PER_HOUR).toISOString();
}

const scoreInput: fc.Arbitrary<ScoreInput> = fc.record({
  source: fc.constantFrom(...sources),
  stage: fc.constantFrom(...stages),
  urgency: fc.constantFrom(...urgencies),
  estimatedValueCents: fc.integer({ min: 0, max: 100_000_000 }),
  hasPhone: fc.boolean(),
  hasEmail: fc.boolean(),
  createdAt: fc.integer({ min: 0, max: 24 * 60 }).map(hoursBefore),
  lastInteractionAt: fc.option(fc.integer({ min: 0, max: 24 * 60 }).map(hoursBefore), {
    nil: null,
  }),
  asOf: fc.constant(AS_OF),
});

function ceiling(stage: LeadStage): number {
  if (stage === 'lost') return SCORE_RULES.caps.lost;
  if (stage === 'won') return SCORE_RULES.caps.won;
  return SCORE_RULES.caps.max;
}

function assertScoreShape(input: ScoreInput, score: LeadScore): void {
  expect(score.score).toBeGreaterThanOrEqual(0);
  expect(score.score).toBeLessThanOrEqual(100);
  expect(score.score).toBeLessThanOrEqual(ceiling(input.stage));
  expect(Number.isInteger(score.score)).toBe(true);
  expect(score.factors.reduce((total, factor) => total + factor.points, 0)).toBe(score.score);
  expect(score.band).toBe(scoreBand(score.score));
  expect(score.disposition).toBe(
    input.stage === 'won' || input.stage === 'lost' ? input.stage : 'open',
  );
  const cap = score.factors.find((factor) => factor.id === 'cap');
  const floor = score.factors.find((factor) => factor.id === 'floor');
  expect(cap && floor).toBeFalsy();
  if (cap) {
    expect(cap.points).toBeLessThan(0);
    expect(score.score).toBe(ceiling(input.stage));
  }
  if (floor) {
    expect(floor.points).toBeGreaterThan(0);
    expect(score.score).toBe(0);
  }
  for (const factor of score.factors) expect(Number.isInteger(factor.points)).toBe(true);
}

function scoresAt(input: ScoreInput, patch: Partial<ScoreInput>[]): number[] {
  return patch.map((overrides) => scoreLead({ ...input, ...overrides }).score);
}

describe('scoreLead properties', () => {
  it('stays inside the published caps and the factors sum to the score', () => {
    fc.assert(
      fc.property(scoreInput, (input) => {
        assertScoreShape(input, scoreLead(input));
      }),
      RUNS,
    );
  });

  it('keeps the same invariants for an unreadable timestamp and a future one', () => {
    fc.assert(
      fc.property(
        scoreInput,
        fc.constantFrom('not-a-date', '2026-12-01T00:00:00.000Z'),
        (input, createdAt) => {
          assertScoreShape(
            { ...input, createdAt, lastInteractionAt: null },
            scoreLead({
              ...input,
              createdAt,
              lastInteractionAt: null,
            }),
          );
        },
      ),
      RUNS,
    );
  });

  it('does not decrease the score for a stronger source, urgency, value, or open stage', () => {
    fc.assert(
      fc.property(scoreInput, (input) => {
        const bySource = scoresAt(input, [
          { source: 'referral' },
          { source: 'website' },
          { source: 'walk_in' },
          { source: 'phone' },
          { source: 'other' },
        ]);
        const byUrgency = scoresAt(input, [
          { urgency: 'low' },
          { urgency: 'normal' },
          { urgency: 'high' },
        ]);
        const byValue = scoresAt(
          input,
          [0, 1, 39_999, 40_000, 149_999, 150_000, 499_999, 500_000, 5_000_000].map(
            (estimatedValueCents) => ({ estimatedValueCents }),
          ),
        );
        const byStage = scoresAt(input, [
          { stage: 'new' },
          { stage: 'contacted' },
          { stage: 'qualified' },
          { stage: 'proposal' },
        ]);
        expect(bySource).toEqual([...bySource].sort((a, b) => b - a));
        expect(byUrgency).toEqual([...byUrgency].sort((a, b) => a - b));
        expect(byValue).toEqual([...byValue].sort((a, b) => a - b));
        expect(byStage).toEqual([...byStage].sort((a, b) => a - b));
      }),
      RUNS,
    );
  });

  it('does not decrease the score when a phone or email is added', () => {
    fc.assert(
      fc.property(scoreInput, (input) => {
        const neither = scoreLead({ ...input, hasPhone: false, hasEmail: false }).score;
        const phone = scoreLead({ ...input, hasPhone: true, hasEmail: false }).score;
        const email = scoreLead({ ...input, hasPhone: false, hasEmail: true }).score;
        const both = scoreLead({ ...input, hasPhone: true, hasEmail: true }).score;
        expect(phone).toBeGreaterThanOrEqual(neither);
        expect(email).toBeGreaterThanOrEqual(neither);
        expect(both).toBeGreaterThanOrEqual(phone);
        expect(both).toBeGreaterThanOrEqual(email);
      }),
      RUNS,
    );
  });

  it('does not increase the score as the lead gets older', () => {
    const ages = [0, 1, 2 - 1 / 24, 2, 6, 7 - 1 / 24, 7, 10, 14, 14 + 1 / 24, 21, 21 + 1 / 24, 40];
    fc.assert(
      fc.property(scoreInput, (input) => {
        const scored = ages.map((days) => {
          const createdAt = new Date(AS_OF.getTime() - Math.round(days * MS_PER_DAY)).toISOString();
          return scoreLead({ ...input, createdAt, lastInteractionAt: null }).score;
        });
        expect(scored).toEqual([...scored].sort((a, b) => b - a));
      }),
      RUNS,
    );
  });
});
