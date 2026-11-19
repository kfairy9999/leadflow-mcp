import { describe, expect, it, vi } from 'vitest';

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

    const root = await worker.fetch(new Request('https://leadflow.test/'), { DB: db });
    expect(root.status).toBe(200);
    const info = (await root.json()) as { service: string; endpoints: Record<string, string> };
    expect(info.service).toBe('leadflow-mcp');
    expect(info.endpoints.health).toBe('/health');
    expect(JSON.stringify(info)).not.toMatch(/lead_[0-9a-z]|@/);

    const postRoot = await worker.fetch(new Request('https://leadflow.test/', { method: 'POST' }), {
      DB: db,
    });
    expect(postRoot.status).toBe(404);

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

  it('ignores seed=always, leaves an empty database on never, and falls back on bad settings', async () => {
    const db = await createFakeD1();
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    try {
      const client = await connectHandler(async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${TOKEN}`);
        return worker.fetch(new Request(url, { ...init, headers }), {
          DB: db,
          LEADFLOW_AUTH_TOKEN: TOKEN,
          LEADFLOW_SEED: 'auto',
        });
      }, 'https://leadflow.test/mcp');
      const created = await client.callTool({
        name: 'create_lead',
        arguments: { contactName: 'Kept', service: 'Leak', source: 'other' },
      });
      expect(textOf(created)).toContain('Kept');
      await client.close();

      const again = await connectHandler(async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${TOKEN}`);
        return worker.fetch(new Request(url, { ...init, headers }), {
          DB: db,
          LEADFLOW_AUTH_TOKEN: `  ${TOKEN}  `,
          LEADFLOW_SEED: 'always',
        });
      }, 'https://leadflow.test/mcp');
      const summary = await again.callTool({ name: 'pipeline_summary', arguments: {} });
      expect(textOf(summary)).toContain('Open: 9');
      expect(errors.join('\n')).toContain('seed.ignored');
      expect(errors.join('\n')).toContain('worker_rejects_always');
      await again.close();

      const short = await worker.fetch(
        new Request('https://leadflow.test/mcp', {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
        { DB: db, LEADFLOW_AUTH_TOKEN: '   short   ' },
      );
      expect(short.status).toBe(503);

      const emptyDb = await createFakeD1();
      const quiet = await connectHandler(async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${TOKEN}`);
        return worker.fetch(new Request(url, { ...init, headers }), {
          DB: emptyDb,
          LEADFLOW_AUTH_TOKEN: TOKEN,
          LEADFLOW_SEED: 'never',
          LEADFLOW_STALE_DAYS: 'nope',
          LEADFLOW_LOG_LEVEL: 'loud',
        });
      }, 'https://leadflow.test/mcp');
      const none = await quiet.callTool({ name: 'pipeline_summary', arguments: {} });
      expect(textOf(none)).toContain('Open: 0');
      expect(textOf(none)).toContain('Stale (>7d)');
      await quiet.close();
    } finally {
      spy.mockRestore();
    }
  });
});
