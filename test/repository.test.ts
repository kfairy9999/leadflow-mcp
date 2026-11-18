import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { LeadFlowError } from '../src/domain/errors.js';
import { scoreLeadRecord } from '../src/domain/scoring.js';
import { summarizePipeline } from '../src/domain/pipeline.js';
import type { CreateLeadInput, UpdateLeadInput } from '../src/domain/types.js';
import { MIGRATION_001_SQL } from '../src/db/migrations.js';
import { migrate } from '../src/db/migrate.js';
import type { SqlDatabase } from '../src/db/sql.js';
import { buildSeed } from '../src/db/seed.js';
import { openNodeSqlite } from '../src/db/node-sqlite.js';
import { FIXED_NOW, openD1, openSqlite, bootstrapped } from './helpers.js';

const databases = [
  { name: 'node:sqlite', open: openSqlite },
  { name: 'd1 adapter', open: openD1 },
];

function blankUpdate(overrides: Partial<UpdateLeadInput> = {}): UpdateLeadInput {
  return {
    contactName: undefined,
    phone: undefined,
    email: undefined,
    service: undefined,
    source: undefined,
    stage: undefined,
    estimatedValueCents: undefined,
    urgency: undefined,
    city: undefined,
    notes: undefined,
    expectedUpdatedAt: undefined,
    ...overrides,
  };
}

function newLead(overrides: Partial<CreateLeadInput> = {}): CreateLeadInput {
  return {
    contactName: 'Ada North',
    phone: '(555) 010-0199',
    email: 'ada.north@example.com',
    service: 'Clogged drain',
    source: 'phone',
    stage: 'new',
    estimatedValueCents: 15_000,
    urgency: 'normal',
    city: 'Harborton',
    notes: null,
    idempotencyKey: null,
    ...overrides,
  };
}

describe.each(databases)('repository ($name)', ({ open }) => {
  const opened: SqlDatabase[] = [];

  afterEach(() => {
    for (const db of opened) db.close();
    opened.length = 0;
  });

  async function repo(seed: 'auto' | 'never' = 'never') {
    const db = await open();
    opened.push(db);
    return bootstrapped(db, seed);
  }

  it('applies the migration once', async () => {
    const db = await open();
    opened.push(db);
    const first = await migrate(db, FIXED_NOW);
    const second = await migrate(db, FIXED_NOW);
    expect(first).toEqual(['0001_init']);
    expect(second).toEqual([]);
  });

  it('creates, updates, and rejects a stale write', async () => {
    const { repository } = await repo();
    const created = await repository.createLead(newLead(), FIXED_NOW);
    expect(created.replay).toBe(false);
    expect(created.lead.stage).toBe('new');

    const later = new Date(FIXED_NOW.getTime() + 60_000);
    const updated = await repository.updateLead(
      created.lead.id,
      blankUpdate({ stage: 'contacted', expectedUpdatedAt: created.lead.updatedAt, phone: null }),
      later,
    );
    expect(updated.stage).toBe('contacted');
    expect(updated.phone).toBeNull();
    expect(updated.updatedAt).not.toBe(created.lead.updatedAt);

    await expect(
      repository.updateLead(
        created.lead.id,
        blankUpdate({ stage: 'qualified', expectedUpdatedAt: created.lead.updatedAt }),
        FIXED_NOW,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(
      repository.updateLead(created.lead.id, blankUpdate(), FIXED_NOW),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(repository.getLead('missing')).resolves.toBeNull();
    await expect(
      repository.updateLead('missing', blankUpdate({ stage: 'won' }), FIXED_NOW),
    ).rejects.toBeInstanceOf(LeadFlowError);
  });

  it('replays an identical create and conflicts when the payload changes', async () => {
    const { repository } = await repo();
    const key = 'retry-key-01';
    const first = await repository.createLead(newLead({ idempotencyKey: key }), FIXED_NOW);
    const second = await repository.createLead(newLead({ idempotencyKey: key }), FIXED_NOW);
    expect(second.replay).toBe(true);
    expect(second.lead.id).toBe(first.lead.id);
    expect(await repository.countLeads()).toBe(1);

    await expect(
      repository.createLead(newLead({ idempotencyKey: key, service: 'Different job' }), FIXED_NOW),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repository.countLeads()).toBe(1);
  });

  it('keeps one lead when two creates share a key', async () => {
    const { repository } = await repo();
    const input = newLead({ idempotencyKey: 'race-key-001' });
    const results = await Promise.all([
      repository.createLead(input, FIXED_NOW),
      repository.createLead(input, FIXED_NOW),
    ]);
    expect(results.filter((result) => result.replay)).toHaveLength(1);
    expect(new Set(results.map((result) => result.lead.id)).size).toBe(1);
    expect(await repository.countLeads()).toBe(1);
  });

  it('searches, scores, and does not treat LIKE wildcards as operators', async () => {
    const { repository, now } = await repo('auto');
    const byName = await repository.searchLeads({
      text: 'Marina',
      stage: null,
      source: null,
      minScore: null,
      sort: 'updated_at',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(byName.leads.map((lead) => lead.id).sort()).toEqual([
      'lead_marina_cho',
      'lead_quinn_harper',
    ]);
    const tankless = await repository.searchLeads({
      text: 'tankless',
      stage: null,
      source: null,
      minScore: null,
      sort: 'updated_at',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(tankless.leads.map((lead) => lead.id)).toEqual(['lead_marina_cho']);

    const wildcard = await repository.searchLeads({
      text: '%',
      stage: null,
      source: null,
      minScore: null,
      sort: 'updated_at',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(wildcard.leads).toHaveLength(0);

    const hot = await repository.searchLeads({
      text: null,
      stage: null,
      source: null,
      minScore: 75,
      sort: 'score',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(hot.leads.every((lead) => scoreLeadRecord(lead, now).score >= 75)).toBe(true);
    const highest = hot.leads[0];
    const lowest = hot.leads[hot.leads.length - 1];
    expect(highest).toBeDefined();
    expect(lowest).toBeDefined();
    if (highest && lowest) {
      expect(scoreLeadRecord(highest, now).score).toBeGreaterThanOrEqual(
        scoreLeadRecord(lowest, now).score,
      );
    }
  });

  it('logs an interaction once and lists due follow-ups', async () => {
    const { repository, now } = await repo('auto');
    const logged = await repository.logInteraction(
      {
        leadId: 'lead_ellis_ward',
        channel: 'call',
        direction: 'outbound',
        summary: 'Confirmed the dishwasher drip.',
        occurredAt: null,
        idempotencyKey: 'ellis-call-01',
      },
      now,
    );
    const again = await repository.logInteraction(
      {
        leadId: 'lead_ellis_ward',
        channel: 'call',
        direction: 'outbound',
        summary: 'Confirmed the dishwasher drip.',
        occurredAt: null,
        idempotencyKey: 'ellis-call-01',
      },
      now,
    );
    expect(again.replay).toBe(true);
    expect(again.interaction.id).toBe(logged.interaction.id);
    expect(await repository.listInteractions('lead_ellis_ward')).toHaveLength(1);

    const due = await repository.listDueFollowUps(now, 20);
    expect(due.map((item) => item.id).sort()).toEqual(
      ['fu_luis_ortega', 'fu_marina_cho', 'fu_priya_nandakumar'].sort(),
    );
    await repository.setFollowUpStatus('fu_marina_cho', 'done', now);
    const after = await repository.listDueFollowUps(now, 20);
    expect(after.map((item) => item.id)).not.toContain('fu_marina_cho');

    await expect(
      repository.logInteraction(
        {
          leadId: 'missing',
          channel: 'note',
          direction: 'inbound',
          summary: 'Nobody home.',
          occurredAt: null,
          idempotencyKey: null,
        },
        now,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('matches the published seed shape', async () => {
    const { repository, now } = await repo('auto');
    expect(await repository.countLeads()).toBe(10);
    const summary = summarizePipeline(await repository.listLeadActivity(), now, 7);
    expect(summary.openLeads).toBe(8);
    expect(summary.won).toBe(1);
    expect(summary.lost).toBe(1);
    expect(summary.winRateLabel).toBe('1/2 (50.0%)');
    expect(summary.openValueCents).toBe(2_105_000);
    expect(summary.staleLeads.map((lead) => lead.id).sort()).toEqual([
      'lead_rowan_blake',
      'lead_samira_adeyemi',
    ]);
    const marina = await repository.getLead('lead_marina_cho');
    const samira = await repository.getLead('lead_samira_adeyemi');
    const helen = await repository.getLead('lead_helen_okonkwo');
    const chris = await repository.getLead('lead_chris_dalton');
    expect(marina && scoreLeadRecord(marina, now).score).toBe(100);
    expect(samira && scoreLeadRecord(samira, now).score).toBe(27);
    expect(helen && scoreLeadRecord(helen, now).score).toBe(40);
    expect(chris && scoreLeadRecord(chris, now).score).toBe(15);
    expect(buildSeed(now).leads).toHaveLength(10);
    expect(buildSeed(now).leads[0]?.id).toBe(buildSeed(now).leads[0]?.id);
  });
});

describe('seed modes', () => {
  it('replaces the database when seed mode is always', async () => {
    const db = await openSqlite();
    const first = await bootstrapped(db, 'auto');
    await first.repository.createLead(
      {
        contactName: 'Temporary',
        phone: null,
        email: null,
        service: 'Temp',
        source: 'other',
        stage: 'new',
        estimatedValueCents: 0,
        urgency: 'low',
        city: null,
        notes: null,
        idempotencyKey: null,
      },
      FIXED_NOW,
    );
    expect(await first.repository.countLeads()).toBe(11);
    const second = await bootstrapped(db, 'always');
    expect(second.seeded).toBe(true);
    expect(await second.repository.countLeads()).toBe(10);
    expect(await second.repository.getLead('lead_marina_cho')).not.toBeNull();
    db.close();
  });
});

describe('node sqlite driver', () => {
  it('rolls a failed transaction back and serializes increments', async () => {
    const db = await openNodeSqlite(':memory:');
    await db.exec('CREATE TABLE counters (n INTEGER)');
    await db.run('INSERT INTO counters (n) VALUES (0)');
    await expect(
      db.transaction(async (tx) => {
        await tx.run('UPDATE counters SET n = 1');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rolled = await db.get<{ n: number }>('SELECT n FROM counters');
    expect(rolled?.n).toBe(0);

    await Promise.all(
      Array.from({ length: 20 }, () =>
        db.transaction(async (tx) => {
          const row = await tx.get<{ n: number }>('SELECT n FROM counters');
          await tx.run('UPDATE counters SET n = ?', [(row?.n ?? 0) + 1]);
        }),
      ),
    );
    const done = await db.get<{ n: number }>('SELECT n FROM counters');
    expect(done?.n).toBe(20);
    db.close();
  });
});

describe('migration file', () => {
  it('matches the SQL embedded for the worker', () => {
    const file = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
    expect(file.trim()).toBe(MIGRATION_001_SQL.trim());
  });
});
