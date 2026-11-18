import { describe, expect, it } from 'vitest';

import worker from '../src/worker.js';
import { createFakeD1 } from './fake-d1.js';
import { connectHandler, textOf } from './helpers.js';

const TOKEN = '0123456789abcdef';

describe('worker entry', () => {
  it('serves health without a token and refuses MCP until a token is set', async () => {
    const db = await createFakeD1();
    const health = await worker.fetch(new Request('https://leadflow.test/health'), { DB: db });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });

    const missing = await worker.fetch(
      new Request('https://leadflow.test/mcp', { method: 'POST' }),
      { DB: db },
    );
    expect(missing.status).toBe(503);

    const denied = await worker.fetch(
      new Request('https://leadflow.test/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-token-value' },
      }),
      { DB: db, LEADFLOW_AUTH_TOKEN: TOKEN },
    );
    expect(denied.status).toBe(401);

    const other = await worker.fetch(new Request('https://leadflow.test/admin'), { DB: db });
    expect(other.status).toBe(404);
  });

  it('seeds and answers tools/list once the bearer token matches', async () => {
    const db = await createFakeD1();
    const env = { DB: db, LEADFLOW_AUTH_TOKEN: TOKEN, LEADFLOW_SEED: 'auto' };
    const client = await connectHandler(async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${TOKEN}`);
      return worker.fetch(new Request(url, { ...init, headers }), env);
    }, 'https://leadflow.test/mcp');
    try {
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'pipeline_summary')).toBe(true);
      const summary = await client.callTool({ name: 'pipeline_summary', arguments: {} });
      expect(textOf(summary)).toContain('Open: 8');
    } finally {
      await client.close();
    }
  });
});
