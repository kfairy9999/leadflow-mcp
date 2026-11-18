import { describe, expect, it } from 'vitest';

import {
  renderScoringModel,
  scoreLead,
  SCORE_RULES,
  type ScoreInput,
} from '../src/domain/scoring.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    source: 'referral',
    stage: 'new',
    urgency: 'normal',
    estimatedValueCents: 0,
    hasPhone: false,
    hasEmail: false,
    createdAt: '2026-11-18T14:00:00.000Z',
    lastInteractionAt: null,
    asOf: NOW,
    ...overrides,
  };
}

describe('scoreLead', () => {
  it('sums factors to the final score, including the ceiling', () => {
    const score = scoreLead(
      input({
        source: 'referral',
        stage: 'proposal',
        urgency: 'high',
        estimatedValueCents: 480_000,
        hasPhone: true,
        hasEmail: true,
        lastInteractionAt: '2026-11-17T19:00:00.000Z',
      }),
    );
    expect(score.factors.reduce((total, factor) => total + factor.points, 0)).toBe(score.score);
    expect(score.score).toBe(100);
    expect(score.band).toBe('hot');
    expect(score.disposition).toBe('open');
    expect(score.factors.some((factor) => factor.id === 'cap' && factor.points < 0)).toBe(true);
  });

  it('caps won and lost leads below the open ceiling', () => {
    const base = input({
      hasPhone: true,
      hasEmail: true,
      urgency: 'high',
      estimatedValueCents: 1_800_000,
      lastInteractionAt: '2026-11-18T12:00:00.000Z',
    });
    const won = scoreLead({ ...base, stage: 'won' });
    const lost = scoreLead({ ...base, stage: 'lost' });
    expect(won.score).toBe(SCORE_RULES.caps.won);
    expect(won.disposition).toBe('won');
    expect(won.summary).toContain('not a follow-up priority');
    expect(lost.score).toBe(SCORE_RULES.caps.lost);
    expect(lost.band).toBe('cold');
    expect(lost.summary).toContain('Closed-lost');
  });

  it('penalizes a quiet lead and an unreachable one', () => {
    const quiet = scoreLead(
      input({
        source: 'website',
        stage: 'contacted',
        urgency: 'normal',
        estimatedValueCents: 22_000,
        hasEmail: true,
        createdAt: '2026-10-01T15:00:00.000Z',
        lastInteractionAt: '2026-10-31T15:00:00.000Z',
      }),
    );
    expect(quiet.factors.find((factor) => factor.id === 'recency')?.points).toBe(
      SCORE_RULES.recency.quietOver14Days,
    );
    const unreachable = scoreLead(input({ createdAt: '2026-11-18T14:00:00.000Z' }));
    expect(unreachable.factors.find((factor) => factor.id === 'unreachable')?.points).toBe(
      SCORE_RULES.unreachable,
    );
  });

  it('treats an unreadable timestamp as quiet and a future one as recent', () => {
    const broken = scoreLead(input({ createdAt: 'not-a-date', hasPhone: true }));
    expect(broken.factors.find((factor) => factor.id === 'recency')?.points).toBe(
      SCORE_RULES.recency.quietOver14Days,
    );
    const future = scoreLead(input({ createdAt: '2026-11-19T00:00:00.000Z', hasPhone: true }));
    expect(future.factors.find((factor) => factor.id === 'recency')?.points).toBe(
      SCORE_RULES.recency.within2Days,
    );
  });

  it('increases the quiet penalty after 21 days', () => {
    const score = scoreLead(
      input({
        hasPhone: true,
        createdAt: '2026-10-01T15:00:00.000Z',
        lastInteractionAt: '2026-10-20T15:00:00.000Z',
      }),
    );
    expect(score.factors.find((factor) => factor.id === 'recency')?.points).toBe(
      SCORE_RULES.recency.quietOver21Days,
    );
  });

  it('publishes the same numbers the scorer uses', () => {
    const markdown = renderScoringModel();
    expect(markdown).toContain('referral');
    expect(markdown).toContain(String(SCORE_RULES.source.referral));
    expect(markdown).toContain(String(SCORE_RULES.caps.lost));
    expect(markdown).toContain('Nothing in this model calls a language model');
  });
});
