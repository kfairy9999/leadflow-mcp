import { describe, expect, it } from 'vitest';

import { csvField, leadsToCsv } from '../src/domain/csv.js';
import { formatUsd } from '../src/domain/money.js';
import { formatWinRate, summarizePipeline } from '../src/domain/pipeline.js';
import { stableStringify } from '../src/domain/hash.js';
import type { LeadActivity } from '../src/domain/types.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');

function lead(partial: Partial<LeadActivity> & Pick<LeadActivity, 'id' | 'stage'>): LeadActivity {
  return {
    contactName: 'Test Person',
    phone: null,
    email: null,
    service: 'Leak',
    source: 'other',
    estimatedValueCents: 0,
    urgency: 'normal',
    city: null,
    notes: null,
    createdAt: '2026-11-18T12:00:00.000Z',
    updatedAt: '2026-11-18T12:00:00.000Z',
    lastInteractionAt: null,
    ...partial,
  };
}

describe('pipeline', () => {
  it('counts stages, open value, win rate, and stale open leads', () => {
    const summary = summarizePipeline(
      [
        lead({ id: 'open-fresh', stage: 'new', estimatedValueCents: 10_000 }),
        lead({
          id: 'open-stale',
          stage: 'qualified',
          estimatedValueCents: 25_000,
          createdAt: '2026-10-01T15:00:00.000Z',
          lastInteractionAt: '2026-11-01T15:00:00.000Z',
        }),
        lead({
          id: 'won',
          stage: 'won',
          estimatedValueCents: 99_000,
          lastInteractionAt: '2026-11-01T15:00:00.000Z',
        }),
        lead({ id: 'lost', stage: 'lost', estimatedValueCents: 50_000 }),
      ],
      NOW,
      7,
    );
    expect(summary.stages).toEqual({
      new: 1,
      contacted: 0,
      qualified: 1,
      proposal: 0,
      won: 1,
      lost: 1,
    });
    expect(summary.openLeads).toBe(2);
    expect(summary.openValueCents).toBe(35_000);
    expect(summary.winRate).toBe(0.5);
    expect(summary.winRateLabel).toBe('1/2 (50.0%)');
    expect(summary.staleCount).toBe(1);
    expect(summary.staleLeads[0]?.id).toBe('open-stale');
    expect(summary.staleLeads[0]?.daysSinceActivity).toBe(17);
  });

  it('says win rate is unavailable when nothing has closed', () => {
    expect(formatWinRate(0, 0)).toBe('n/a (no closed leads)');
    const summary = summarizePipeline([lead({ id: 'only', stage: 'new' })], NOW, 7);
    expect(summary.winRate).toBeNull();
  });
});

describe('csv and money', () => {
  it('formats cents without floating point', () => {
    expect(formatUsd(2_105_000)).toBe('$21,050.00');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(-125)).toBe('-$1.25');
  });

  it('escapes quotes, commas, newlines, and formula triggers', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField(null)).toBe('');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('=CMD()')).toBe("'=CMD()");
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-2')).toBe("'-2");
    expect(csvField('@sum')).toBe("'@sum");
  });

  it('writes a header and one data row', () => {
    const csv = leadsToCsv(
      [lead({ id: 'lead_a', stage: 'new', contactName: '=cmd', notes: 'has, comma' })],
      NOW,
    );
    expect(csv.startsWith('id,contact_name,')).toBe(true);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain('"has, comma"');
    expect(csv.endsWith('\n')).toBe(true);
  });
});

describe('canonical hash', () => {
  it('ignores key order and undefined fields', () => {
    expect(stableStringify({ b: 1, a: 'x' })).toBe(stableStringify({ a: 'x', b: 1 }));
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});
