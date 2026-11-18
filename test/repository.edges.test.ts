import { afterEach, describe, expect, it } from 'vitest';

import { LeadFlowError } from '../src/domain/errors.js';
import type { CreateLeadInput, UpdateLeadInput } from '../src/domain/types.js';
import type { SqlDatabase, SqlExecutor, SqlValue } from '../src/db/sql.js';
import { LeadRepository } from '../src/db/repository.js';
import { migrate } from '../src/db/migrate.js';
import { FIXED_NOW, bootstrapped, openD1, openSqlite } from './helpers.js';

const drivers = [
  { name: 'node:sqlite', open: openSqlite },
  { name: 'd1 adapter', open: openD1 },
];

function lead(overrides: Partial<CreateLeadInput> = {}): CreateLeadInput {
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
    notes: 'Drip',
    idempotencyKey: null,
    ...overrides,
  };
}

function blank(overrides: Partial<UpdateLeadInput> = {}) {
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

function uniqueError(): Error {
  return Object.assign(new Error('UNIQUE constraint failed: idempotency_keys.scope'), {
    code: 'SQLITE_CONSTRAINT_UNIQUE',
  });
}

function bindMember(value: unknown, target: object): unknown {
  if (typeof value !== 'function') return value;
  const member = value as (this: unknown, ...args: never[]) => unknown;
  return member.bind(target);
}

function delegate(db: SqlDatabase, patch: Partial<SqlDatabase>): SqlDatabase {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in patch) return patch[prop as keyof SqlDatabase];
      return bindMember(Reflect.get(target, prop, receiver), target);
    },
  });
}

function faultWrites(db: SqlDatabase, fault: (sql: string) => Error | undefined): SqlDatabase {
  const wrap = (tx: SqlExecutor): SqlExecutor => ({
    all: (sql, params) => tx.all(sql, params),
    get: (sql, params) => tx.get(sql, params),
    run: (sql, params) => {
      const error = fault(sql);
      if (error) return Promise.reject(error);
      return tx.run(sql, params);
    },
  });
  return delegate(db, {
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
  });
}

describe.each(drivers)('repository edges ($name)', ({ open }) => {
  const opened: SqlDatabase[] = [];

  afterEach(() => {
    for (const db of opened) db.close();
    opened.length = 0;
  });

  async function setup(seed: 'auto' | 'never' = 'never') {
    const db = await open();
    opened.push(db);
    const started = await bootstrapped(db, seed);
    return { db, ...started };
  }

  it('stores one instant for every spelling and orders interactions by that instant', async () => {
    const { repository } = await setup();
    const created = await repository.createLead(lead(), FIXED_NOW);
    const earlier = await repository.logInteraction(
      {
        leadId: created.lead.id,
        channel: 'email',
        direction: 'outbound',
        summary: 'Earlier note, later-looking text.',
        occurredAt: '2026-11-18T15:00:00+05:00',
        idempotencyKey: 'spell-early-01',
      },
      FIXED_NOW,
    );
    const later = await repository.logInteraction(
      {
        leadId: created.lead.id,
        channel: 'call',
        direction: 'inbound',
        summary: 'Later note.',
        occurredAt: '2026-11-18T11:00:00.000Z',
        idempotencyKey: null,
      },
      FIXED_NOW,
    );
    expect(earlier.interaction.occurredAt).toBe('2026-11-18T10:00:00.000Z');
    expect(later.interaction.occurredAt).toBe('2026-11-18T11:00:00.000Z');
    const stored = await repository.getLead(created.lead.id);
    expect(stored?.lastInteractionAt).toBe('2026-11-18T11:00:00.000Z');
    expect(stored?.updatedAt).toBe(FIXED_NOW.toISOString());
    const listed = await repository.listInteractions(created.lead.id);
    expect(listed.map((item) => item.occurredAt)).toEqual([
      '2026-11-18T11:00:00.000Z',
      '2026-11-18T10:00:00.000Z',
    ]);
  });

  it('keeps updatedAt on the server clock when the conversation was in the past', async () => {
    const { repository } = await setup();
    const created = await repository.createLead(lead(), FIXED_NOW);
    const logged = await repository.logInteraction(
      {
        leadId: created.lead.id,
        channel: 'note',
        direction: 'outbound',
        summary: 'Backdated site visit.',
        occurredAt: '2026-10-01T15:00:00.000Z',
        idempotencyKey: null,
      },
      FIXED_NOW,
    );
    expect(logged.interaction.occurredAt).toBe('2026-10-01T15:00:00.000Z');
    const stored = await repository.getLead(created.lead.id);
    expect(stored?.updatedAt).toBe(FIXED_NOW.toISOString());
    expect(stored?.lastInteractionAt).toBe('2026-10-01T15:00:00.000Z');
  });

  it('treats equivalent due times as one follow-up and compares them as instants', async () => {
    const { repository } = await setup();
    const created = await repository.createLead(lead(), FIXED_NOW);
    const key = 'due-spell-01';
    const first = await repository.scheduleFollowUp(
      {
        leadId: created.lead.id,
        dueAt: '2026-11-18T16:00:00+01:00',
        reason: 'Same instant, offset spelling.',
        idempotencyKey: key,
      },
      FIXED_NOW,
    );
    const replay = await repository.scheduleFollowUp(
      {
        leadId: created.lead.id,
        dueAt: '2026-11-18T15:00:00.000Z',
        reason: 'Same instant, offset spelling.',
        idempotencyKey: key,
      },
      FIXED_NOW,
    );
    expect(first.followUp.dueAt).toBe('2026-11-18T15:00:00.000Z');
    expect(replay.replay).toBe(true);
    expect(replay.followUp.id).toBe(first.followUp.id);

    const bareZ = await repository.scheduleFollowUp(
      {
        leadId: created.lead.id,
        dueAt: '2026-11-18T15:00:00Z',
        reason: 'No milliseconds.',
        idempotencyKey: 'due-bare-z-01',
      },
      FIXED_NOW,
    );
    expect(bareZ.followUp.dueAt).toBe('2026-11-18T15:00:00.000Z');

    const futureText = await repository.scheduleFollowUp(
      {
        leadId: created.lead.id,
        dueAt: '2026-11-18T20:30:00+05:00',
        reason: 'Looks earlier as text, is 15:30Z.',
        idempotencyKey: null,
      },
      FIXED_NOW,
    );
    expect(futureText.followUp.dueAt).toBe('2026-11-18T15:30:00.000Z');

    const atExact = await repository.listDueFollowUps(new Date('2026-11-18T15:00:00.000Z'), 20);
    const ids = atExact.map((item) => item.id);
    expect(ids).toContain(first.followUp.id);
    expect(ids).toContain(bareZ.followUp.id);
    expect(ids).not.toContain(futureText.followUp.id);
    const before = await repository.listDueFollowUps(new Date('2026-11-18T14:59:59.999Z'), 20);
    expect(before.map((item) => item.id)).not.toContain(first.followUp.id);

    await expect(
      repository.scheduleFollowUp(
        {
          leadId: created.lead.id,
          dueAt: 'not-a-date',
          reason: 'Broken clock.',
          idempotencyKey: null,
        },
        FIXED_NOW,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('replays an omitted interaction time and conflicts when the summary changes', async () => {
    const { repository } = await setup();
    const created = await repository.createLead(lead(), FIXED_NOW);
    const key = 'omit-time-01';
    const input = {
      leadId: created.lead.id,
      channel: 'sms' as const,
      direction: 'outbound' as const,
      summary: 'On my way.',
      occurredAt: null,
      idempotencyKey: key,
    };
    const first = await repository.logInteraction(input, FIXED_NOW);
    const later = new Date(FIXED_NOW.getTime() + 3_600_000);
    const second = await repository.logInteraction(input, later);
    expect(second.replay).toBe(true);
    expect(second.interaction.id).toBe(first.interaction.id);
    expect(second.interaction.occurredAt).toBe(FIXED_NOW.toISOString());
    expect(await repository.listInteractions(created.lead.id)).toHaveLength(1);

    await expect(
      repository.logInteraction({ ...input, summary: 'Different words.' }, later),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const unkeyed = await repository.logInteraction(
      { ...input, idempotencyKey: null, summary: 'A second note.' },
      later,
    );
    expect(unkeyed.replay).toBe(false);
    expect(await repository.listInteractions(created.lead.id)).toHaveLength(2);
  });

  it('does not rewrite a lead when the follow-up status is set twice', async () => {
    const { repository } = await setup();
    const created = await repository.createLead(lead(), FIXED_NOW);
    const scheduled = await repository.scheduleFollowUp(
      {
        leadId: created.lead.id,
        dueAt: '2026-11-18T12:00:00.000Z',
        reason: 'Call back.',
        idempotencyKey: 'status-01',
      },
      FIXED_NOW,
    );
    const again = await repository.scheduleFollowUp(
      {
        leadId: created.lead.id,
        dueAt: '2026-11-18T12:00:00.000Z',
        reason: 'Call back.',
        idempotencyKey: 'status-01',
      },
      FIXED_NOW,
    );
    expect(again.replay).toBe(true);

    const doneAt = new Date(FIXED_NOW.getTime() + 60_000);
    const done = await repository.setFollowUpStatus(scheduled.followUp.id, 'done', doneAt);
    expect(done.status).toBe('done');
    const afterDone = await repository.getLead(created.lead.id);
    expect(afterDone?.updatedAt).toBe(doneAt.toISOString());
    expect((await repository.listDueFollowUps(doneAt, 10)).map((item) => item.id)).not.toContain(
      scheduled.followUp.id,
    );

    const later = new Date(doneAt.getTime() + 60_000);
    const repeat = await repository.setFollowUpStatus(scheduled.followUp.id, 'done', later);
    expect(repeat.status).toBe('done');
    expect((await repository.getLead(created.lead.id))?.updatedAt).toBe(doneAt.toISOString());

    await repository.setFollowUpStatus(scheduled.followUp.id, 'scheduled', later);
    expect((await repository.listDueFollowUps(later, 10)).map((item) => item.id)).toContain(
      scheduled.followUp.id,
    );
    await repository.setFollowUpStatus(scheduled.followUp.id, 'cancelled', later);
    expect((await repository.listDueFollowUps(later, 10)).map((item) => item.id)).not.toContain(
      scheduled.followUp.id,
    );

    const unkeyed = await repository.scheduleFollowUp(
      {
        leadId: created.lead.id,
        dueAt: '2026-11-19T12:00:00.000Z',
        reason: 'Another call.',
        idempotencyKey: null,
      },
      later,
    );
    expect(unkeyed.replay).toBe(false);
    const followUps = await repository.listFollowUps(created.lead.id);
    expect(followUps.map((item) => item.dueAt)).toEqual([
      '2026-11-18T12:00:00.000Z',
      '2026-11-19T12:00:00.000Z',
    ]);
  });

  it('patches every field, including clearing nullable ones and writing zero cents', async () => {
    const { repository } = await setup();
    const created = await repository.createLead(lead(), FIXED_NOW);
    const later = new Date(FIXED_NOW.getTime() + 1_000);
    const patched = await repository.updateLead(
      created.lead.id,
      blank({
        contactName: 'Ada South',
        phone: '5550100123',
        email: 'ada.south@example.com',
        service: 'Sewer scope',
        source: 'referral',
        stage: 'proposal',
        estimatedValueCents: 0,
        urgency: 'high',
        city: 'North Harborton',
        notes: 'Bring the camera.',
        expectedUpdatedAt: created.lead.updatedAt,
      }),
      later,
    );
    expect(patched).toMatchObject({
      contactName: 'Ada South',
      phone: '5550100123',
      email: 'ada.south@example.com',
      service: 'Sewer scope',
      source: 'referral',
      stage: 'proposal',
      estimatedValueCents: 0,
      urgency: 'high',
      city: 'North Harborton',
      notes: 'Bring the camera.',
      updatedAt: later.toISOString(),
    });
    const cleared = await repository.updateLead(
      created.lead.id,
      blank({ phone: null, email: null, city: null, notes: null }),
      new Date(later.getTime() + 1_000),
    );
    expect(cleared.phone).toBeNull();
    expect(cleared.email).toBeNull();
    expect(cleared.city).toBeNull();
    expect(cleared.notes).toBeNull();
    expect(cleared.contactName).toBe('Ada South');
  });

  it('lets one of two racing updates win and rejects a check violation', async () => {
    const { repository } = await setup();
    const created = await repository.createLead(lead(), FIXED_NOW);
    const results = await Promise.allSettled([
      repository.updateLead(
        created.lead.id,
        blank({ city: 'North' }),
        new Date(FIXED_NOW.getTime() + 1_000),
      ),
      repository.updateLead(
        created.lead.id,
        blank({ city: 'South' }),
        new Date(FIXED_NOW.getTime() + 2_000),
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(LeadFlowError);
      expect((rejected.reason as LeadFlowError).code).toBe('CONFLICT');
    }

    await expect(
      repository.createLead(lead({ estimatedValueCents: -1 }), FIXED_NOW),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it('sorts ties by updatedAt and escapes LIKE wildcards', async () => {
    const { repository, now } = await setup();
    const older = await repository.createLead(
      lead({ contactName: 'Older', estimatedValueCents: 50_000, service: '100%_done\\today' }),
      new Date(FIXED_NOW.getTime() - 60_000),
    );
    const newer = await repository.createLead(
      lead({ contactName: 'Newer', estimatedValueCents: 50_000, service: 'Other job' }),
      FIXED_NOW,
    );
    const byValue = await repository.searchLeads({
      text: null,
      stage: 'new',
      source: 'phone',
      minScore: 0,
      sort: 'value',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(byValue.leads.map((item) => item.id)).toEqual([newer.lead.id, older.lead.id]);
    const byScore = await repository.searchLeads({
      text: null,
      stage: null,
      source: null,
      minScore: null,
      sort: 'score',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(byScore.leads.map((item) => item.id)).toEqual([newer.lead.id, older.lead.id]);
    const byCreated = await repository.searchLeads({
      text: null,
      stage: null,
      source: null,
      minScore: null,
      sort: 'created_at',
      limit: 1,
      offset: 1,
      asOf: now,
    });
    expect(byCreated.leads.map((item) => item.id)).toEqual([older.lead.id]);
    const wildcard = await repository.searchLeads({
      text: '100%_done\\today',
      stage: null,
      source: null,
      minScore: null,
      sort: 'updated_at',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(wildcard.leads.map((item) => item.id)).toEqual([older.lead.id]);
    const pastEnd = await repository.searchLeads({
      text: null,
      stage: null,
      source: null,
      minScore: null,
      sort: 'updated_at',
      limit: 10,
      offset: 50,
      asOf: now,
    });
    expect(pastEnd.leads).toEqual([]);
    expect(pastEnd.truncated).toBe(false);
  });

  it('reports a missing replay target after the row is removed', async () => {
    const { db, repository } = await setup();
    const created = await repository.createLead(
      lead({ idempotencyKey: 'gone-lead-01' }),
      FIXED_NOW,
    );
    await db.run('DELETE FROM leads WHERE id = ?', [created.lead.id]);
    await expect(
      repository.createLead(lead({ idempotencyKey: 'gone-lead-01' }), FIXED_NOW),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const kept = await repository.createLead(lead(), FIXED_NOW);
    const logged = await repository.logInteraction(
      {
        leadId: kept.lead.id,
        channel: 'note',
        direction: 'inbound',
        summary: 'Will be deleted.',
        occurredAt: null,
        idempotencyKey: 'gone-int-01',
      },
      FIXED_NOW,
    );
    await db.run('DELETE FROM interactions WHERE id = ?', [logged.interaction.id]);
    await expect(
      repository.logInteraction(
        {
          leadId: kept.lead.id,
          channel: 'note',
          direction: 'inbound',
          summary: 'Will be deleted.',
          occurredAt: null,
          idempotencyKey: 'gone-int-01',
        },
        FIXED_NOW,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      repository.logInteraction(
        {
          leadId: kept.lead.id,
          channel: 'note',
          direction: 'inbound',
          summary: 'Will be deleted.',
          occurredAt: null,
          idempotencyKey: 'gone-int-01',
        },
        FIXED_NOW,
      ),
    ).rejects.toThrow(/interaction/i);

    const scheduled = await repository.scheduleFollowUp(
      {
        leadId: kept.lead.id,
        dueAt: '2026-11-18T12:00:00.000Z',
        reason: 'Will be deleted.',
        idempotencyKey: 'gone-fu-01',
      },
      FIXED_NOW,
    );
    await db.run('DELETE FROM follow_ups WHERE id = ?', [scheduled.followUp.id]);
    await expect(
      repository.scheduleFollowUp(
        {
          leadId: kept.lead.id,
          dueAt: '2026-11-18T12:00:00.000Z',
          reason: 'Will be deleted.',
          idempotencyKey: 'gone-fu-01',
        },
        FIXED_NOW,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      repository.scheduleFollowUp(
        {
          leadId: kept.lead.id,
          dueAt: '2026-11-18T12:00:00.000Z',
          reason: 'Will be deleted.',
          idempotencyKey: 'gone-fu-01',
        },
        FIXED_NOW,
      ),
    ).rejects.toThrow(/follow-up/i);
  });

  it('caps search at 500 and export at 5000', async () => {
    const { db, repository, now } = await setup();
    await db.transaction(async (tx) => {
      for (let index = 0; index < 5_001; index += 1) {
        const id = `bulk_${index.toString().padStart(4, '0')}`;
        await tx.run(
          `INSERT INTO leads (
            id, contact_name, phone, email, service, source, stage,
            estimated_value_cents, urgency, city, notes, created_at, updated_at
          ) VALUES (?, ?, NULL, NULL, ?, 'other', 'new', 0, 'low', NULL, NULL, ?, ?)`,
          [id, `Bulk ${index}`, 'Scan', '2026-11-01T00:00:00.000Z', '2026-11-18T00:00:00.000Z'],
        );
      }
    });
    const searched = await repository.searchLeads({
      text: 'Scan',
      stage: null,
      source: null,
      minScore: null,
      sort: 'updated_at',
      limit: 10,
      offset: 0,
      asOf: now,
    });
    expect(searched.truncated).toBe(true);
    expect(searched.leads).toHaveLength(10);
    const exported = await repository.leadsForExport(null);
    expect(exported.truncated).toBe(true);
    expect(exported.leads).toHaveLength(5_000);
    const staged = await repository.leadsForExport('won');
    expect(staged.truncated).toBe(false);
    expect(staged.leads).toHaveLength(0);
  });

  it('rejects a stored value the check constraint would not normally allow', async () => {
    const { db, repository } = await setup();
    await db.exec('PRAGMA ignore_check_constraints = ON');
    const created = await repository.createLead(lead(), FIXED_NOW);
    await db.run('UPDATE leads SET stage = ? WHERE id = ?', ['nope', created.lead.id]);
    await expect(repository.getLead(created.lead.id)).rejects.toThrow(/nope/);
  });
});

describe('repository fault mapping', () => {
  it('replays a unique collision with no stored request, maps foreign keys, and counts a missing row as zero', async () => {
    const db = await openSqlite();
    await migrate(db, FIXED_NOW);
    const counted = new LeadRepository(
      delegate(db, {
        get: async (sql: string, params?: readonly SqlValue[]) => {
          if (sql.includes('COUNT(*)')) return undefined;
          return db.get(sql, params);
        },
      }),
    );
    expect(await counted.countLeads()).toBe(0);

    const colliding = new LeadRepository(
      faultWrites(db, (sql) => (sql.includes('idempotency_keys') ? uniqueError() : undefined)),
    );
    await expect(
      colliding.createLead(lead({ idempotencyKey: 'collide-key-1' }), FIXED_NOW),
    ).rejects.toThrow(/no stored request/i);

    const plain = new LeadRepository(db);
    const created = await plain.createLead(lead(), FIXED_NOW);
    const foreign = new LeadRepository(
      faultWrites(db, (sql) =>
        sql.includes('INSERT INTO interactions') || sql.includes('INSERT INTO follow_ups')
          ? new Error('FOREIGN KEY constraint failed')
          : undefined,
      ),
    );
    await expect(
      foreign.logInteraction(
        {
          leadId: created.lead.id,
          channel: 'call',
          direction: 'inbound',
          summary: 'Race.',
          occurredAt: null,
          idempotencyKey: null,
        },
        FIXED_NOW,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      foreign.scheduleFollowUp(
        {
          leadId: created.lead.id,
          dueAt: '2026-11-18T12:00:00.000Z',
          reason: 'Race.',
          idempotencyKey: null,
        },
        FIXED_NOW,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const disk = new LeadRepository(
      faultWrites(db, (sql) =>
        sql.includes('INSERT INTO leads') ? new Error('disk I/O error') : undefined,
      ),
    );
    await expect(disk.createLead(lead(), FIXED_NOW)).rejects.toThrow(/disk I\/O error/);

    const logDisk = new LeadRepository(
      faultWrites(db, (sql) =>
        sql.includes('INSERT INTO interactions') ? new Error('log disk') : undefined,
      ),
    );
    await expect(
      logDisk.logInteraction(
        {
          leadId: created.lead.id,
          channel: 'note',
          direction: 'inbound',
          summary: 'Disk.',
          occurredAt: null,
          idempotencyKey: null,
        },
        FIXED_NOW,
      ),
    ).rejects.toThrow(/log disk/);
    const followDisk = new LeadRepository(
      faultWrites(db, (sql) =>
        sql.includes('INSERT INTO follow_ups') ? new Error('follow disk') : undefined,
      ),
    );
    await expect(
      followDisk.scheduleFollowUp(
        {
          leadId: created.lead.id,
          dueAt: '2026-11-18T12:00:00.000Z',
          reason: 'Disk.',
          idempotencyKey: null,
        },
        FIXED_NOW,
      ),
    ).rejects.toThrow(/follow disk/);
    db.close();
  });
});
