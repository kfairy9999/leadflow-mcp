import { ProtocolError, ProtocolErrorCode, createMcpHandler } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { LeadRepository } from '../src/db/repository.js';
import { LeadFlowError } from '../src/domain/errors.js';
import { createLeadFlowServer, leadUri } from '../src/mcp/server.js';
import { bootstrapped, connectHandler, isErrored, openSqlite, textOf } from './helpers.js';
import { call, expectToolError, openLeadClient } from './mcp-harness.js';
import type { Client } from '@modelcontextprotocol/client';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers) await close();
  closers.length = 0;
});

function leadIdFrom(text: string): string {
  const match = /lead_[a-z0-9]+/.exec(text);
  if (!match) throw new Error(`No lead id in tool text: ${text}`);
  return match[0];
}

async function client(seed: 'auto' | 'never' = 'never'): Promise<Client> {
  const opened = await openLeadClient(seed);
  closers.push(() => opened.close());
  return opened.client;
}

const baseLead = {
  contactName: 'Ada North',
  service: 'Clogged drain',
  source: 'phone' as const,
  phone: '5550100',
  email: 'ada.north@example.com',
};

describe('create_lead', () => {
  it('rejects invalid, boundary, and duplicate-key payloads', async () => {
    const mcp = await client();
    const rejected: Array<[Record<string, unknown>, RegExp]> = [
      [{}, /contactName|service|source/i],
      [{ ...baseLead, contactName: '   ' }, /contactName|at least 1|too small/i],
      [{ ...baseLead, contactName: 'a'.repeat(121) }, /120|too big|at most/i],
      [{ ...baseLead, service: '' }, /service|at least 1|too small/i],
      [{ ...baseLead, service: 's'.repeat(201) }, /200|too big|at most/i],
      [{ ...baseLead, source: 'billboard' }, /source|invalid/i],
      [{ ...baseLead, phone: 'call me' }, /Phone may contain only digits/],
      [{ ...baseLead, phone: '555-010' }, /at least 7 digits/],
      [{ ...baseLead, phone: '+'.repeat(7) }, /at least 7 digits/],
      [{ ...baseLead, phone: '1'.repeat(21) }, /20|too big|at most/i],
      [{ ...baseLead, email: 'not-an-email' }, /email/i],
      [{ ...baseLead, email: `${'a'.repeat(190)}@example.com` }, /email|200|too big/i],
      [{ ...baseLead, estimatedValueCents: -1 }, /estimatedValue|too small|at least 0/i],
      [{ ...baseLead, estimatedValueCents: 1.5 }, /integer|estimatedValue/i],
      [{ ...baseLead, estimatedValueCents: 100_000_001 }, /100000000|too big|at most/i],
      [{ ...baseLead, city: 'c'.repeat(81) }, /80|too big|city/i],
      [{ ...baseLead, notes: 'n'.repeat(4001) }, /4000|too big|notes/i],
      [{ ...baseLead, idempotencyKey: 'short' }, /8|idempotency|too small/i],
      [{ ...baseLead, idempotencyKey: 'k'.repeat(81) }, /80|too big|idempotency/i],
      [{ ...baseLead, idempotencyKey: 'has space' }, /Idempotency keys may contain/],
      [{ ...baseLead, idempotencyKey: 'key/slash' }, /Idempotency keys may contain/],
      [{ ...baseLead, stage: 'archived' }, /stage|invalid/i],
      [{ ...baseLead, urgency: 'panic' }, /urgency|invalid/i],
    ];
    for (const [args, pattern] of rejected) {
      expectToolError(await call(mcp, 'create_lead', args), pattern);
    }

    const edges = await call(mcp, 'create_lead', {
      contactName: '王'.repeat(120),
      service: 's'.repeat(200),
      source: 'walk_in',
      phone: `+${'1'.repeat(18)}`,
      email: 'ada.north@example.com',
      city: 'c'.repeat(80),
      notes: 'n'.repeat(4000),
      estimatedValueCents: 100_000_000,
      urgency: 'low',
      stage: 'qualified',
      idempotencyKey: `k${'e'.repeat(79)}`,
    });
    expect(isErrored(edges)).toBe(false);
    expect(edges.text).toContain('王'.repeat(120));
    expect(edges.text).toContain('Replay: no');

    const first = await call(mcp, 'create_lead', {
      ...baseLead,
      contactName: 'José Álvarez',
      service: 'Réparation — chaudière 🔧',
      idempotencyKey: 'unicode-key-01',
    });
    const replay = await call(mcp, 'create_lead', {
      ...baseLead,
      contactName: 'José Álvarez',
      service: 'Réparation — chaudière 🔧',
      idempotencyKey: 'unicode-key-01',
    });
    expect(first.text).toContain('Replay: no');
    expect(replay.text).toContain('Replay: yes, existing lead returned');
    expect(replay.text.slice(0, replay.text.indexOf(' ·'))).toBe(
      first.text.slice(0, first.text.indexOf(' ·')),
    );
    expectToolError(
      await call(mcp, 'create_lead', {
        ...baseLead,
        contactName: 'Someone else',
        idempotencyKey: 'unicode-key-01',
      }),
      /CONFLICT/,
    );

    const dupA = await call(mcp, 'create_lead', baseLead);
    const dupB = await call(mcp, 'create_lead', baseLead);
    expect(dupA.text).not.toContain(dupB.text.slice(0, 20));
  });
});

describe('update_lead and get_lead', () => {
  it('rejects a missing id, a stale token, an empty patch, and bad ids', async () => {
    const mcp = await client();
    const created = await call(mcp, 'create_lead', baseLead);
    const leadId = leadIdFrom(created.text);
    expectToolError(await call(mcp, 'get_lead', { leadId: 'missing_lead' }), /NOT_FOUND/);
    expectToolError(await call(mcp, 'get_lead', { leadId: 'has space' }), /Lead ids contain/);
    expectToolError(await call(mcp, 'get_lead', { leadId: '' }), /Lead ids|too small|at least/i);
    expectToolError(await call(mcp, 'get_lead', { leadId: 'a'.repeat(81) }), /80|too big/i);
    expectToolError(
      await call(mcp, 'update_lead', { leadId: 'missing_lead', stage: 'won' }),
      /NOT_FOUND/,
    );
    expectToolError(await call(mcp, 'update_lead', { leadId }), /at least one field/i);
    expectToolError(
      await call(mcp, 'update_lead', {
        leadId,
        stage: 'won',
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
      /CONFLICT/,
    );
    expectToolError(
      await call(mcp, 'update_lead', { leadId, phone: '12' }),
      /Phone|7 digits|too small/i,
    );

    const got = await call(mcp, 'get_lead', { leadId });
    const updatedAt = /updatedAt":"([^"]+)"/.exec(JSON.stringify(got))?.[1];
    const cleared = await call(mcp, 'update_lead', {
      leadId,
      phone: null,
      email: null,
      city: null,
      notes: null,
      contactName: 'Ada South',
      estimatedValueCents: 0,
      ...(updatedAt ? { expectedUpdatedAt: updatedAt } : {}),
    });
    expect(isErrored(cleared)).toBe(false);
    expect(cleared.text).toContain('Ada South');
    const after = await call(mcp, 'get_lead', { leadId });
    expect(after.text).toContain('hard to reach');
  });
});

describe('search_leads', () => {
  it('rejects bad queries and ranks unicode, wildcards, and an empty page', async () => {
    const mcp = await client();
    await call(mcp, 'create_lead', {
      ...baseLead,
      contactName: 'José Álvarez',
      service: '100%_done\\today',
      city: 'São Paulo',
      notes: 'café notes',
    });
    const found = await call(mcp, 'search_leads', { text: 'josé', sort: 'score' });
    expect(found.text).toContain('José Álvarez');
    expect(found.text).toMatch(/^1 lead/);
    const exact = await call(mcp, 'search_leads', { text: '100%_done\\today' });
    expect(exact.text).toContain('José Álvarez');
    const none = await call(mcp, 'search_leads', { text: 'no-such-person', limit: 100, offset: 0 });
    expect(none.text).toBe('0 leads');
    const wildcard = await call(mcp, 'search_leads', { text: '%', limit: 100, offset: 0 });
    expect(wildcard.text).toContain('José Álvarez');
    expect(wildcard.text).not.toContain('scan truncated');
    const page = await call(mcp, 'search_leads', { offset: 10_000, limit: 1 });
    expect(page.text).toBe('0 leads');
    const byStage = await call(mcp, 'search_leads', {
      stage: 'new',
      source: 'phone',
      sort: 'created_at',
    });
    expect(byStage.text).toContain('José Álvarez');
    const byValue = await call(mcp, 'search_leads', { sort: 'value', minScore: 0, limit: 25 });
    expect(isErrored(byValue)).toBe(false);

    const rejected: Array<[Record<string, unknown>, RegExp]> = [
      [{ text: 't'.repeat(201) }, /200|too big|text/i],
      [{ stage: 'archived' }, /stage|invalid/i],
      [{ source: 'billboard' }, /source|invalid/i],
      [{ minScore: -1 }, /minScore|too small/i],
      [{ minScore: 101 }, /100|too big|minScore/i],
      [{ minScore: 1.5 }, /integer|minScore/i],
      [{ sort: 'name' }, /sort|invalid/i],
      [{ limit: 0 }, /limit|too small|at least 1/i],
      [{ limit: 101 }, /100|too big|limit/i],
      [{ offset: -1 }, /offset|too small/i],
      [{ offset: 10_001 }, /10000|too big|offset/i],
    ];
    for (const [args, pattern] of rejected) {
      expectToolError(await call(mcp, 'search_leads', args), pattern);
    }
  });
});

describe('score_lead', () => {
  it('rejects a missing lead and a bad clock, and scores a past asOf', async () => {
    const mcp = await client();
    const created = await call(mcp, 'create_lead', {
      ...baseLead,
      source: 'referral',
      urgency: 'high',
      estimatedValueCents: 500_000,
    });
    const leadId = leadIdFrom(created.text);
    expectToolError(await call(mcp, 'score_lead', { leadId: 'missing_lead' }), /NOT_FOUND/);
    expectToolError(
      await call(mcp, 'score_lead', { leadId, asOf: '2026-11-18T15:00:00' }),
      /ISO-8601/,
    );
    expectToolError(
      await call(mcp, 'score_lead', { leadId, asOf: '2026-13-01T00:00:00.000Z' }),
      /ISO-8601/,
    );
    expectToolError(
      await call(mcp, 'score_lead', { leadId, asOf: '2026-11-18T15:00:00z' }),
      /ISO-8601/,
    );
    const now = await call(mcp, 'score_lead', { leadId });
    expect(now.text).toContain('under 2 days ago');
    const later = await call(mcp, 'score_lead', { leadId, asOf: '2026-12-20T15:00:00+00:00' });
    expect(later.text).toContain('quiet-lead penalty increases after 21 days');
    expect(isErrored(later)).toBe(false);
  });
});

describe('log_interaction', () => {
  it('rejects bad input and replays an omitted timestamp', async () => {
    const mcp = await client();
    const created = await call(mcp, 'create_lead', baseLead);
    const leadId = leadIdFrom(created.text);
    expectToolError(
      await call(mcp, 'log_interaction', {
        leadId: 'missing_lead',
        channel: 'call',
        direction: 'inbound',
        summary: 'Nobody there.',
      }),
      /NOT_FOUND/,
    );
    const rejected: Array<[Record<string, unknown>, RegExp]> = [
      [{ leadId, channel: 'fax', direction: 'inbound', summary: 'Hi' }, /channel|invalid/i],
      [{ leadId, channel: 'call', direction: 'sideways', summary: 'Hi' }, /direction|invalid/i],
      [
        { leadId, channel: 'call', direction: 'inbound', summary: '   ' },
        /summary|at least 1|too small/i,
      ],
      [
        { leadId, channel: 'call', direction: 'inbound', summary: 's'.repeat(2001) },
        /2000|too big|summary/i,
      ],
      [
        {
          leadId,
          channel: 'note',
          direction: 'outbound',
          summary: 'When?',
          occurredAt: '2026-11-18',
        },
        /ISO-8601/,
      ],
    ];
    for (const [args, pattern] of rejected) {
      expectToolError(await call(mcp, 'log_interaction', args), pattern);
    }

    const key = 'log-retry-key';
    const first = await call(mcp, 'log_interaction', {
      leadId,
      channel: 'sms',
      direction: 'outbound',
      summary: 'On my way, José.',
      idempotencyKey: key,
    });
    const second = await call(mcp, 'log_interaction', {
      leadId,
      channel: 'sms',
      direction: 'outbound',
      summary: 'On my way, José.',
      idempotencyKey: key,
    });
    expect(first.text).toContain('Replay: no');
    expect(second.text).toContain('Replay: yes');
    expectToolError(
      await call(mcp, 'log_interaction', {
        leadId,
        channel: 'sms',
        direction: 'outbound',
        summary: 'Different text.',
        idempotencyKey: key,
      }),
      /CONFLICT/,
    );
    const stamped = await call(mcp, 'log_interaction', {
      leadId,
      channel: 'visit',
      direction: 'inbound',
      summary: 'Offset spelling.',
      occurredAt: '2026-11-18T10:00:00-05:00',
      idempotencyKey: 'offset-log-01',
    });
    expect(stamped.text).toContain('2026-11-18T15:00:00.000Z');
    const sameInstant = await call(mcp, 'log_interaction', {
      leadId,
      channel: 'visit',
      direction: 'inbound',
      summary: 'Offset spelling.',
      occurredAt: '2026-11-18T15:00:00Z',
      idempotencyKey: 'offset-log-01',
    });
    expect(sameInstant.text).toContain('Replay: yes');
  });
});

describe('follow-ups', () => {
  it('handles timezone edges, idempotency, and a repeated status', async () => {
    const mcp = await client();
    const created = await call(mcp, 'create_lead', baseLead);
    const leadId = leadIdFrom(created.text);
    expect(textOf(await mcp.callTool({ name: 'list_due_follow_ups', arguments: {} }))).toContain(
      'No follow-ups due',
    );
    expectToolError(
      await call(mcp, 'schedule_follow_up', {
        leadId: 'missing_lead',
        dueAt: '2026-11-18T15:00:00.000Z',
        reason: 'Missing.',
      }),
      /NOT_FOUND/,
    );
    expectToolError(
      await call(mcp, 'schedule_follow_up', {
        leadId,
        dueAt: '2026-11-18T15:00:00',
        reason: 'No zone.',
      }),
      /ISO-8601/,
    );
    expectToolError(
      await call(mcp, 'schedule_follow_up', {
        leadId,
        dueAt: '2026-11-18T15:00:00.000Z',
        reason: '',
      }),
      /reason|at least 1|too small/i,
    );
    expectToolError(
      await call(mcp, 'schedule_follow_up', {
        leadId,
        dueAt: '2026-11-18T15:00:00.000Z',
        reason: 'r'.repeat(501),
      }),
      /500|too big|reason/i,
    );

    const key = 'fu-retry-key1';
    const first = await call(mcp, 'schedule_follow_up', {
      leadId,
      dueAt: '2026-11-18T16:00:00+01:00',
      reason: 'Same instant.',
      idempotencyKey: key,
    });
    const replay = await call(mcp, 'schedule_follow_up', {
      leadId,
      dueAt: '2026-11-18T15:00:00.000Z',
      reason: 'Same instant.',
      idempotencyKey: key,
    });
    expect(first.text).toContain('2026-11-18T15:00:00.000Z');
    expect(first.text).toContain('Replay: no');
    expect(replay.text).toContain('Replay: yes');
    const followUpId = /Scheduled (fu_[a-z0-9]+)/.exec(first.text)?.[1];
    if (!followUpId) throw new Error('missing follow-up id');

    const notYet = await call(mcp, 'list_due_follow_ups', { asOf: '2026-11-18T10:00:00-04:00' });
    expect(notYet.text).toContain('No follow-ups due');
    const due = await call(mcp, 'list_due_follow_ups', {
      asOf: '2026-11-18T10:00:00-05:00',
      limit: 1,
    });
    expect(due.text).toContain('1 follow-up due');
    expect(due.text).toContain(followUpId);

    const laterText = await call(mcp, 'schedule_follow_up', {
      leadId,
      dueAt: '2026-11-18T20:30:00+05:00',
      reason: 'Still in the future at 15:00Z.',
    });
    const laterId = /Scheduled (fu_[a-z0-9]+)/.exec(laterText.text)?.[1];
    const atPinned = await call(mcp, 'list_due_follow_ups', { asOf: '2026-11-18T15:00:00.000Z' });
    expect(atPinned.text).toContain(followUpId);
    expect(atPinned.text).not.toContain(laterId ?? 'missing');

    const done = await call(mcp, 'set_follow_up_status', { followUpId, status: 'done' });
    const doneAgain = await call(mcp, 'set_follow_up_status', { followUpId, status: 'done' });
    expect(done.text).toContain(`${followUpId} is done.`);
    expect(doneAgain.text).toBe(done.text);
    const afterDone = await call(mcp, 'list_due_follow_ups', { asOf: '2026-11-18T15:00:00.000Z' });
    expect(afterDone.text).not.toContain(followUpId);

    expectToolError(
      await call(mcp, 'set_follow_up_status', { followUpId: 'fu_missing', status: 'cancelled' }),
      /NOT_FOUND/,
    );
    expectToolError(
      await call(mcp, 'set_follow_up_status', { followUpId, status: 'paused' }),
      /status|invalid/i,
    );
    expectToolError(
      await call(mcp, 'list_due_follow_ups', { limit: 0 }),
      /limit|too small|at least 1/i,
    );
    expectToolError(await call(mcp, 'list_due_follow_ups', { limit: 201 }), /200|too big|limit/i);
    expectToolError(
      await call(mcp, 'list_due_follow_ups', { asOf: '2026-11-18 15:00:00Z' }),
      /ISO-8601/,
    );

    if (!laterId) throw new Error('missing later id');
    await call(mcp, 'set_follow_up_status', { followUpId: laterId, status: 'cancelled' });
    await call(mcp, 'set_follow_up_status', { followUpId: laterId, status: 'scheduled' });
    const broughtBack = await call(mcp, 'list_due_follow_ups', {
      asOf: '2026-12-01T00:00:00.000Z',
    });
    expect(broughtBack.text).toContain(laterId);
  });
});

describe('pipeline_summary and export_leads_csv', () => {
  it('summarizes an empty pipeline and escapes formula, comma, quote, and newline cells', async () => {
    const mcp = await client();
    const empty = await call(mcp, 'pipeline_summary', {});
    expect(empty.text).toContain('Open: 0');
    expect(empty.text).toContain('Win rate: n/a (no closed leads)');
    expect(empty.text).toContain('Open value: $0.00');
    expect(empty.text).toContain('Stale (>7d): 0');
    const exportedEmpty = await call(mcp, 'export_leads_csv', {});
    expect(exportedEmpty.text).toContain('Exported 0 leads');
    expect(exportedEmpty.text).toContain('Value in view: $0.00');
    expect(exportedEmpty.text).toContain('id,contact_name,');

    await call(mcp, 'create_lead', {
      contactName: '=HYPERLINK("http://evil")',
      service: '+install',
      source: 'other',
      city: '-town',
      notes: '@SUM(A1)\nhe said "hi", then left',
      phone: '+15550100',
      estimatedValueCents: 48_000,
    });
    await call(mcp, 'create_lead', {
      contactName: 'Comma, "Name"',
      service: 'Line\nbreak',
      source: 'website',
      stage: 'won',
    });
    const csv = await call(mcp, 'export_leads_csv', { asOf: '2026-11-18T16:00:00+01:00' });
    expect(csv.text).toContain('Exported 2 leads');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).toContain("'+install");
    expect(csv.text).toContain("'-town");
    expect(csv.text).toContain("'+15550100");
    expect(csv.text).toContain("'@SUM(A1)");
    expect(csv.text).toContain('"Comma, ""Name"""');
    expect(csv.text).toContain('"Line\nbreak"');
    const won = await call(mcp, 'export_leads_csv', { stage: 'won' });
    expect(won.text).toContain('Exported 1 lead.');
    expect(won.text).not.toContain('Exported 1 leads');

    expectToolError(
      await call(mcp, 'pipeline_summary', { staleAfterDays: 0 }),
      /1|too small|stale/i,
    );
    expectToolError(
      await call(mcp, 'pipeline_summary', { staleAfterDays: 91 }),
      /90|too big|stale/i,
    );
    expectToolError(await call(mcp, 'pipeline_summary', { asOf: 'yesterday' }), /ISO-8601/);
    expectToolError(await call(mcp, 'export_leads_csv', { stage: 'archived' }), /stage|invalid/i);
    const narrow = await call(mcp, 'pipeline_summary', {
      staleAfterDays: 1,
      asOf: '2026-12-01T00:00:00.000Z',
    });
    expect(narrow.text).toContain('Stale (>1d):');
  });
});

describe('seeded front desk edges', () => {
  it('uses singular and plural copy and the seeded due order', async () => {
    const mcp = await client('auto');
    const due = await call(mcp, 'list_due_follow_ups', { limit: 1 });
    expect(due.text).toContain('1 follow-up due');
    expect(due.text).toContain('fu_priya_nandakumar');
    const summary = await call(mcp, 'pipeline_summary', { staleAfterDays: 90 });
    expect(summary.text).toContain('Stale (>90d): 0');
    const many = await call(mcp, 'search_leads', { limit: 2 });
    expect(many.text).toMatch(/^2 leads/);
    const one = await call(mcp, 'search_leads', { text: 'tankless', limit: 5 });
    expect(one.text).toMatch(/^1 lead\n/);
  });
});

describe('prompts', () => {
  it('fills defaults and rejects a missing draft lead', async () => {
    const mcp = await client('auto');
    const briefing = await mcp.getPrompt({ name: 'daily_follow_up_briefing', arguments: {} });
    const briefingText = textContent(briefing.messages[0]?.content);
    expect(briefingText).toContain('friendly');
    expect(briefingText).toContain('Do not invent');
    const concise = await mcp.getPrompt({
      name: 'daily_follow_up_briefing',
      arguments: { tone: 'concise', staleAfterDays: '14' },
    });
    expect(textContent(concise.messages[0]?.content)).toContain('concise');
    const draft = await mcp.getPrompt({
      name: 'draft_follow_up',
      arguments: { leadId: 'lead_marina_cho' },
    });
    expect(textContent(draft.messages[0]?.content)).toContain('call');
    expect(textContent(draft.messages[0]?.content)).toContain('Marina Cho');
    await expect(
      mcp.getPrompt({ name: 'draft_follow_up', arguments: { leadId: 'lead_missing' } }),
    ).rejects.toThrow(/lead_missing|No lead|not found/i);
  });
});

describe('caps the model can see', () => {
  it('says when the search or the stale list is truncated', async () => {
    const db = await openSqlite();
    const started = await bootstrapped(db, 'never');
    await db.transaction(async (tx) => {
      for (let index = 0; index < 51; index += 1) {
        await tx.run(
          `INSERT INTO leads (
            id, contact_name, phone, email, service, source, stage,
            estimated_value_cents, urgency, city, notes, created_at, updated_at
          ) VALUES (?, ?, NULL, NULL, 'Cap', 'other', 'new', 0, 'low', NULL, NULL, ?, ?)`,
          [
            `cap_${index.toString().padStart(4, '0')}`,
            `Cap ${index}`,
            '2026-10-01T00:00:00.000Z',
            '2026-11-18T00:00:00.000Z',
          ],
        );
      }
    });
    const mcp = await connect(started.repository, started);
    const summary = await call(mcp, 'pipeline_summary', { staleAfterDays: 7 });
    expect(summary.text).toContain('Stale (>7d): 51 (list truncated)');
    await db.transaction(async (tx) => {
      for (let index = 51; index < 501; index += 1) {
        await tx.run(
          `INSERT INTO leads (
            id, contact_name, phone, email, service, source, stage,
            estimated_value_cents, urgency, city, notes, created_at, updated_at
          ) VALUES (?, ?, NULL, NULL, 'Cap', 'other', 'new', 0, 'low', NULL, NULL, ?, ?)`,
          [
            `cap_${index.toString().padStart(4, '0')}`,
            `Cap ${index}`,
            '2026-11-18T00:00:00.000Z',
            '2026-11-18T00:00:00.000Z',
          ],
        );
      }
    });
    const searched = await call(mcp, 'search_leads', { text: 'Cap' });
    expect(searched.text).toContain('(scan truncated at 500)');
    await db.transaction(async (tx) => {
      for (let index = 501; index < 5_001; index += 1) {
        await tx.run(
          `INSERT INTO leads (
            id, contact_name, phone, email, service, source, stage,
            estimated_value_cents, urgency, city, notes, created_at, updated_at
          ) VALUES (?, ?, NULL, NULL, 'Cap', 'other', 'new', 100, 'low', NULL, NULL, ?, ?)`,
          [
            `cap_${index.toString().padStart(4, '0')}`,
            `Cap ${index}`,
            '2026-11-18T00:00:00.000Z',
            '2026-11-18T00:00:00.000Z',
          ],
        );
      }
    });
    const exported = await call(mcp, 'export_leads_csv', {});
    expect(exported.text).toContain('Exported 5000 leads (truncated at 5000).');
    await mcp.close();
    db.close();
  });
});

describe('tool and resource failures', () => {
  it('hides unexpected throws and maps stored validation to a protocol error', async () => {
    const db = await openSqlite();
    const started = await bootstrapped(db, 'never');
    const created = await started.repository.createLead(
      {
        contactName: 'Ada',
        phone: null,
        email: null,
        service: 'Leak',
        source: 'other',
        stage: 'new',
        estimatedValueCents: 0,
        urgency: 'low',
        city: null,
        notes: null,
        idempotencyKey: null,
      },
      started.now,
    );
    const flaky = stub(started.repository, {
      getLead: () => Promise.reject(new Error('disk exploded')),
    });
    const disk = await connect(flaky, started);
    const internal = await call(disk, 'score_lead', { leadId: created.lead.id });
    expect(internal.text).toBe('INTERNAL: Unexpected error while running this tool.');
    expect(internal.text).not.toContain('disk');
    expect(started.lines.join('\n')).toContain('"errorName":"Error"');
    await disk.close();

    const stringy = stub(started.repository, {
      // The unknown errorName branch only runs for a rejection that is not an Error.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      getLead: () => Promise.reject('nope'),
    });
    const unknown = await connect(stringy, started);
    await call(unknown, 'score_lead', { leadId: created.lead.id });
    expect(started.lines.join('\n')).toContain('"errorName":"unknown"');
    await unknown.close();

    const invalid = stub(started.repository, {
      getLead: () => Promise.reject(new LeadFlowError('VALIDATION', 'Stored stage is nonsense.')),
    });
    const bad = await connect(invalid, started);
    await expect(bad.readResource({ uri: leadUri(created.lead.id) })).rejects.toThrow(/nonsense/);
    await bad.close();

    const protocol = stub(started.repository, {
      listLeadActivity: () =>
        Promise.reject(new ProtocolError(ProtocolErrorCode.InvalidParams, 'already protocol')),
    });
    const passed = await connect(protocol, started);
    await expect(passed.readResource({ uri: 'leadflow://pipeline' })).rejects.toThrow(
      /already protocol/,
    );
    await passed.close();

    const generic = stub(started.repository, {
      listLeadActivity: () => Promise.reject(new Error('boom')),
    });
    const wrapped = await connect(generic, started);
    await expect(wrapped.readResource({ uri: 'leadflow://pipeline' })).rejects.toThrow(
      /Unexpected error while reading the resource/,
    );
    await wrapped.close();
    db.close();
  });
});

function textContent(content: unknown): string {
  if (
    content &&
    typeof content === 'object' &&
    'text' in content &&
    typeof content.text === 'string'
  ) {
    return content.text;
  }
  return '';
}

function bindMember(value: unknown, target: object): unknown {
  if (typeof value !== 'function') return value;
  const member = value as (this: unknown, ...args: never[]) => unknown;
  return member.bind(target);
}

function stub(repository: LeadRepository, overrides: Partial<LeadRepository>): LeadRepository {
  return new Proxy(repository, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(overrides, prop)) {
        return overrides[prop as keyof LeadRepository];
      }
      return bindMember(Reflect.get(target, prop, receiver), target);
    },
  });
}

async function connect(
  repository: LeadRepository,
  started: Awaited<ReturnType<typeof bootstrapped>>,
): Promise<Client & { close: () => Promise<void> }> {
  const handler = createMcpHandler(() =>
    createLeadFlowServer({
      repository,
      logger: started.logger,
      clock: started.clock,
      staleAfterDays: 7,
    }),
  );
  const mcp = await connectHandler((url, init) => handler.fetch(new Request(url, init)));
  const closeClient = mcp.close.bind(mcp);
  return Object.assign(mcp, {
    close: async () => {
      await closeClient();
      await handler.close();
    },
  });
}
