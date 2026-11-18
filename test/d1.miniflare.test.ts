import { afterAll, describe, expect, it } from 'vitest';

import worker from '../src/worker.js';
import { D1SqlDatabase } from '../src/db/d1.js';
import type { SqlDatabase } from '../src/db/sql.js';
import { migrate } from '../src/db/migrate.js';
import { FIXED_NOW, bootstrapped, connectHandler, openSqlite, textOf } from './helpers.js';
import { startMiniflare, type MiniflareHandle } from './miniflare.js';

const TOKEN = '0123456789abcdef';

describe('node:sqlite and Miniflare D1', () => {
  let miniflare: MiniflareHandle | undefined;

  afterAll(async () => {
    await miniflare?.dispose();
  });

  it('migrates an empty database twice and keeps a round trip in parity', async () => {
    miniflare = await startMiniflare();
    const sqlite = await openSqlite();
    const d1 = new D1SqlDatabase(miniflare.database);
    try {
      expect(await schemaFingerprint(sqlite)).toEqual(await schemaFingerprint(d1));
      await exercise(sqlite);
      await exercise(d1);
      expect(await schemaFingerprint(sqlite)).toEqual(await schemaFingerprint(d1));
    } finally {
      sqlite.close();
      d1.close();
    }
  });

  it('serves the worker entry on that D1 binding', async () => {
    const handle = await startMiniflare();
    try {
      const env = {
        DB: handle.database,
        LEADFLOW_AUTH_TOKEN: TOKEN,
        LEADFLOW_SEED: 'auto',
        LEADFLOW_STALE_DAYS: '7',
      };
      const health = await worker.fetch(new Request('https://leadflow.test/health'), env);
      expect(health.status).toBe(200);
      const denied = await worker.fetch(
        new Request('https://leadflow.test/mcp', {
          method: 'POST',
          headers: { authorization: 'Bearer wrong-token-value' },
        }),
        env,
      );
      expect(denied.status).toBe(401);
      expect(await denied.text()).not.toContain('Marina');

      const client = await connectHandler(async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${TOKEN}`);
        return worker.fetch(new Request(url, { ...init, headers }), env);
      }, 'https://leadflow.test/mcp');
      try {
        const summary = await client.callTool({ name: 'pipeline_summary', arguments: {} });
        expect(textOf(summary)).toContain('Open: 8');
        const scheduled = await client.callTool({
          name: 'schedule_follow_up',
          arguments: {
            leadId: 'lead_ellis_ward',
            dueAt: '2026-11-18T16:00:00+01:00',
            reason: 'Miniflare offset.',
            idempotencyKey: 'mf-due-key-01',
          },
        });
        expect(textOf(scheduled)).toContain('2026-11-18T15:00:00.000Z');
      } finally {
        await client.close();
      }
    } finally {
      await handle.dispose();
    }
  });
});

async function exercise(db: SqlDatabase): Promise<void> {
  expect(await migrate(db, FIXED_NOW)).toEqual(['0001_init']);
  expect(await migrate(db, FIXED_NOW)).toEqual([]);
  const { repository } = await bootstrapped(db, 'never');
  const created = await repository.createLead(
    {
      contactName: 'Parity',
      phone: null,
      email: 'parity@example.com',
      service: 'Leak',
      source: 'website',
      stage: 'new',
      estimatedValueCents: 12_500,
      urgency: 'high',
      city: 'Harborton',
      notes: null,
      idempotencyKey: 'parity-key-01',
    },
    FIXED_NOW,
  );
  const replay = await repository.createLead(
    {
      contactName: 'Parity',
      phone: null,
      email: 'parity@example.com',
      service: 'Leak',
      source: 'website',
      stage: 'new',
      estimatedValueCents: 12_500,
      urgency: 'high',
      city: 'Harborton',
      notes: null,
      idempotencyKey: 'parity-key-01',
    },
    FIXED_NOW,
  );
  expect(replay.replay).toBe(true);
  expect(replay.lead.id).toBe(created.lead.id);
  await repository.logInteraction(
    {
      leadId: created.lead.id,
      channel: 'email',
      direction: 'outbound',
      summary: 'Earlier as an offset.',
      occurredAt: '2026-11-18T15:00:00+05:00',
      idempotencyKey: null,
    },
    FIXED_NOW,
  );
  await repository.logInteraction(
    {
      leadId: created.lead.id,
      channel: 'call',
      direction: 'inbound',
      summary: 'Later in UTC.',
      occurredAt: '2026-11-18T11:00:00.000Z',
      idempotencyKey: null,
    },
    FIXED_NOW,
  );
  const lead = await repository.getLead(created.lead.id);
  expect(lead?.lastInteractionAt).toBe('2026-11-18T11:00:00.000Z');
  expect(lead?.updatedAt).toBe(FIXED_NOW.toISOString());
  const followUp = await repository.scheduleFollowUp(
    {
      leadId: created.lead.id,
      dueAt: '2026-11-18T16:00:00+01:00',
      reason: 'Call',
      idempotencyKey: null,
    },
    FIXED_NOW,
  );
  expect(followUp.followUp.dueAt).toBe('2026-11-18T15:00:00.000Z');
  const due = await repository.listDueFollowUps(FIXED_NOW, 10);
  expect(due.map((item) => item.id)).toContain(followUp.followUp.id);
  await db.run('DELETE FROM leads WHERE id = ?', [created.lead.id]);
  expect(
    await repository.listInteractions(created.lead.id).catch((error: unknown) => error),
  ).toMatchObject({ code: 'NOT_FOUND' });
  const left = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM interactions');
  expect(left?.n).toBe(0);
}

async function schemaFingerprint(db: SqlDatabase): Promise<unknown> {
  const tables = ['schema_migrations', 'leads', 'interactions', 'follow_ups', 'idempotency_keys'];
  const columns = [];
  for (const table of tables) {
    columns.push({
      table,
      columns: await db.all(
        `SELECT name, type, "notnull" AS required, pk FROM pragma_table_info('${table}') ORDER BY cid`,
      ),
      indexes: await db.all(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name`,
        [table],
      ),
    });
  }
  return columns;
}
