import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { fixedClock } from '../src/clock.js';
import { openNodeSqlite } from '../src/db/node-sqlite.js';
import { bootstrap } from '../src/db/seed.js';
import { createLogger } from '../src/logger.js';
import { createLeadFlowServer } from '../src/mcp/server.js';

export const DEMO_CLOCK = '2026-11-18T15:00:00.000Z';

/** A real MCP session against the fictional Northglass Plumbing seed. */
export async function runDemo(now = new Date(DEMO_CLOCK)): Promise<string> {
  const db = await openNodeSqlite(':memory:');
  const logger = createLogger({ level: 'error', write: () => undefined });
  const clock = fixedClock(now);
  const { repository } = await bootstrap(db, { seed: 'auto', now, logger });
  const handler = createMcpHandler(() =>
    createLeadFlowServer({ repository, logger, clock, staleAfterDays: 7 }),
  );
  const client = new Client(
    { name: 'leadflow-demo', version: '0.1.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://leadflow.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );

  const lines: string[] = [];
  const call = async (name: string, args: Record<string, unknown>): Promise<void> => {
    lines.push(`$ ${name} ${JSON.stringify(args)}`);
    const result = await client.callTool({ name, arguments: args });
    const content = result.content[0];
    const text = content && 'text' in content ? content.text : '';
    lines.push(text, '');
  };

  lines.push(
    'LeadFlow MCP  ·  Northglass Plumbing, Harborton (fictional)',
    `clock ${now.toISOString()}  ·  in-process MCP client, seeded SQLite`,
    '',
  );
  const listed = await client.listTools();
  lines.push('$ tools/list', listed.tools.map((tool) => tool.name).join('  '), '');
  await call('pipeline_summary', {});
  await call('list_due_follow_ups', {});
  await call('score_lead', { leadId: 'lead_marina_cho' });
  await call('score_lead', { leadId: 'lead_samira_adeyemi' });
  await call('create_lead', {
    contactName: 'Demo Replay',
    service: 'Faucet drip',
    source: 'website',
    email: 'demo.replay@example.com',
    idempotencyKey: 'demo-replay-01',
  });
  await call('create_lead', {
    contactName: 'Demo Replay',
    service: 'Faucet drip',
    source: 'website',
    email: 'demo.replay@example.com',
    idempotencyKey: 'demo-replay-01',
  });

  await client.close();
  await handler.close();
  db.close();
  return `${lines.join('\n').replace(/\n$/, '')}\n`;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file:').href;

if (invokedDirectly) {
  const override = process.env.LEADFLOW_NOW;
  const now = override ? new Date(override) : new Date(DEMO_CLOCK);
  if (Number.isNaN(now.getTime())) {
    console.error('LEADFLOW_NOW must be an ISO-8601 datetime.');
    process.exitCode = 1;
  } else {
    process.stdout.write(await runDemo(now));
  }
}
