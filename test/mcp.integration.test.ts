import { createMcpHandler } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { createLeadFlowServer } from '../src/mcp/server.js';
import { PIPELINE_URI, SCORING_URI, leadUri } from '../src/mcp/server.js';
import { connectHandler, isErrored, resourceText, seededSqlite, textOf } from './helpers.js';
import type { Client } from '@modelcontextprotocol/client';

describe('MCP client', () => {
  const clients: Client[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const client of clients) await client.close();
    clients.length = 0;
    for (const close of closers) await close();
    closers.length = 0;
  });

  async function clientFor(seed: 'auto' | 'never' = 'auto') {
    const started = await seededSqlite(seed);
    const handler = createMcpHandler(() =>
      createLeadFlowServer({
        repository: started.repository,
        logger: started.logger,
        clock: started.clock,
        staleAfterDays: 7,
      }),
    );
    const client = await connectHandler((url, init) => handler.fetch(new Request(url, init)));
    clients.push(client);
    closers.push(() => handler.close());
    return { client, started };
  }

  it('lists the front-desk tools, resources, and prompts', async () => {
    const { client } = await clientFor();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'create_lead',
        'export_leads_csv',
        'get_lead',
        'list_due_follow_ups',
        'log_interaction',
        'pipeline_summary',
        'schedule_follow_up',
        'score_lead',
        'search_leads',
        'set_follow_up_status',
        'update_lead',
      ].sort(),
    );
    const resources = await client.listResources();
    const uris = resources.resources.map((resource) => resource.uri);
    expect(uris).toContain(PIPELINE_URI);
    expect(uris).toContain(SCORING_URI);
    expect(uris).toContain(leadUri('lead_marina_cho'));
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual([
      'daily_follow_up_briefing',
      'draft_follow_up',
    ]);
  });

  it('rejects a bad phone before the handler and reports a missing lead as a tool error', async () => {
    const { client, started } = await clientFor('never');
    const invalid = await client.callTool({
      name: 'create_lead',
      arguments: { contactName: 'Ada', service: 'Leak', source: 'phone', phone: 'call me' },
    });
    expect(isErrored(invalid)).toBe(true);
    expect(textOf(invalid)).toMatch(/phone/i);
    expect(await started.repository.countLeads()).toBe(0);

    const missing = await client.callTool({
      name: 'get_lead',
      arguments: { leadId: 'lead_missing' },
    });
    expect(isErrored(missing)).toBe(true);
    expect(textOf(missing)).toContain('NOT_FOUND');
    expect(started.lines.join('\n')).not.toContain('example.com');
  });

  it('runs the seeded front desk through the client', async () => {
    const { client, started } = await clientFor('auto');
    const summary = await client.callTool({ name: 'pipeline_summary', arguments: {} });
    expect(isErrored(summary)).toBe(false);
    expect(textOf(summary)).toContain('Open: 8');
    expect(textOf(summary)).toContain('$21,050.00');
    expect(textOf(summary)).toContain('Win rate: 1/2 (50.0%)');

    const due = await client.callTool({ name: 'list_due_follow_ups', arguments: {} });
    expect(textOf(due)).toContain('fu_marina_cho');
    expect(textOf(due)).not.toContain('fu_jonah_feldman');

    const scored = await client.callTool({
      name: 'score_lead',
      arguments: { leadId: 'lead_marina_cho' },
    });
    expect(textOf(scored)).toContain('100/100 hot');
    expect(textOf(scored)).toContain('Referral');

    const pipeline = await client.readResource({ uri: PIPELINE_URI });
    expect(resourceText(pipeline.contents[0])).toContain('"openLeads":8');
    const model = await client.readResource({ uri: SCORING_URI });
    expect(resourceText(model.contents[0])).toContain('referral');
    const lead = await client.readResource({ uri: leadUri('lead_marina_cho') });
    expect(resourceText(lead.contents[0])).toContain('Marina Cho');
    await expect(client.readResource({ uri: leadUri('lead_missing') })).rejects.toThrow(
      /lead_missing|not found|No lead/i,
    );

    const created = await client.callTool({
      name: 'create_lead',
      arguments: {
        contactName: 'Demo Replay',
        service: 'Faucet drip',
        source: 'website',
        email: 'demo.replay@example.com',
        idempotencyKey: 'demo-replay-01',
      },
    });
    const replayed = await client.callTool({
      name: 'create_lead',
      arguments: {
        contactName: 'Demo Replay',
        service: 'Faucet drip',
        source: 'website',
        email: 'demo.replay@example.com',
        idempotencyKey: 'demo-replay-01',
      },
    });
    expect(textOf(created)).toContain('Replay: no');
    expect(textOf(replayed)).toContain('Replay: yes');
    expect(started.lines.join('\n')).not.toContain('demo.replay@example.com');

    const briefing = await client.getPrompt({
      name: 'daily_follow_up_briefing',
      arguments: { tone: 'concise' },
    });
    const briefingText = briefing.messages[0]?.content;
    expect(briefingText && 'text' in briefingText ? briefingText.text : '').toContain(
      'Do not invent',
    );

    const draft = await client.getPrompt({
      name: 'draft_follow_up',
      arguments: { leadId: 'lead_chris_dalton', channel: 'email' },
    });
    const draftText = draft.messages[0]?.content;
    expect(draftText && 'text' in draftText ? draftText.text : '').toContain('Do not discount');
  });

  it('updates, searches, exports, and closes the loop on a follow-up', async () => {
    const { client } = await clientFor('auto');
    const got = await client.callTool({
      name: 'get_lead',
      arguments: { leadId: 'lead_ellis_ward' },
    });
    expect(textOf(got)).toContain('Ellis Ward');

    const updated = await client.callTool({
      name: 'update_lead',
      arguments: { leadId: 'lead_ellis_ward', stage: 'contacted', notes: null },
    });
    expect(isErrored(updated)).toBe(false);
    expect(textOf(updated)).toContain('contacted');

    const empty = await client.callTool({
      name: 'update_lead',
      arguments: { leadId: 'lead_ellis_ward' },
    });
    expect(textOf(empty)).toContain('VALIDATION');

    const byValue = await client.callTool({
      name: 'search_leads',
      arguments: { sort: 'value', limit: 2 },
    });
    expect(textOf(byValue)).toContain('lead_jonah_feldman');
    const byCreated = await client.callTool({
      name: 'search_leads',
      arguments: { sort: 'created_at', limit: 2 },
    });
    expect(textOf(byCreated)).toContain('lead_');

    const logged = await client.callTool({
      name: 'log_interaction',
      arguments: {
        leadId: 'lead_ellis_ward',
        channel: 'sms',
        direction: 'outbound',
        summary: 'Sent the arrival window.',
        idempotencyKey: 'ellis-sms-01',
      },
    });
    expect(textOf(logged)).toContain('Replay: no');

    const scheduled = await client.callTool({
      name: 'schedule_follow_up',
      arguments: {
        leadId: 'lead_ellis_ward',
        dueAt: '2026-11-18T12:00:00.000Z',
        reason: 'Confirm the drip stopped.',
        idempotencyKey: 'ellis-fu-01',
      },
    });
    const scheduledText = textOf(scheduled);
    expect(scheduledText).toContain('Replay: no');
    const followUpId = /Scheduled (fu_[a-z0-9]+)/.exec(scheduledText)?.[1];
    if (!followUpId) throw new Error('schedule_follow_up did not return an id');
    const done = await client.callTool({
      name: 'set_follow_up_status',
      arguments: { followUpId, status: 'done' },
    });
    expect(textOf(done)).toContain('done');

    const missing = await client.callTool({
      name: 'set_follow_up_status',
      arguments: { followUpId: 'fu_missing', status: 'cancelled' },
    });
    expect(textOf(missing)).toContain('NOT_FOUND');

    const none = await client.callTool({
      name: 'list_due_follow_ups',
      arguments: { asOf: '2020-01-01T00:00:00.000Z', limit: 1 },
    });
    expect(textOf(none)).toContain('No follow-ups due');

    const exported = await client.callTool({
      name: 'export_leads_csv',
      arguments: { stage: 'won' },
    });
    expect(textOf(exported)).toContain('Exported 1 lead');
    expect(textOf(exported)).toContain('lead_helen_okonkwo');

    await expect(
      client.getPrompt({ name: 'draft_follow_up', arguments: { leadId: 'missing' } }),
    ).rejects.toThrow();
  });
});
