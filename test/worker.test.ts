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

    const api = await worker.fetch(new Request('https://leadflow.test/api'), { DB: db });
    expect(api.status).toBe(200);
    expect(api.headers.get('x-content-type-options')).toBe('nosniff');
    const info = (await api.json()) as { service: string; endpoints: Record<string, string> };
    expect(info.service).toBe('leadflow-mcp');
    expect(info.endpoints.health).toBe('/health');
    expect(info.endpoints.api).toBe('/api');
    expect(JSON.stringify(info)).not.toMatch(/lead_[0-9a-z]|@example\.com|555-/);

    const negotiated = await worker.fetch(
      new Request('https://leadflow.test/', { headers: { accept: 'application/json' } }),
      { DB: db },
    );
    expect(negotiated.headers.get('content-type')).toMatch(/application\/json/);
    expect(await negotiated.json()).toMatchObject({ service: 'leadflow-mcp' });

    const page = await worker.fetch(new Request('https://leadflow.test/'), { DB: db });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    const html = await page.text();
    expect(html).toContain('The front desk for a one-shop business.');
    expect(html).toContain('Marina Cho');
    expect(html).toContain('Recorded demo');
    expect(html).not.toMatch(/LEADFLOW_AUTH_TOKEN/);

    const head = await worker.fetch(new Request('https://leadflow.test/', { method: 'HEAD' }), {
      DB: db,
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toMatch(/text\/html/);
    expect(await head.text()).toBe('');

    const headHealth = await worker.fetch(
      new Request('https://leadflow.test/health', { method: 'HEAD' }),
      { DB: db },
    );
    expect(headHealth.status).toBe(200);
    expect(headHealth.headers.get('content-type')).toMatch(/application\/json/);

    const robots = await worker.fetch(new Request('https://leadflow.test/robots.txt'), { DB: db });
    expect(robots.status).toBe(200);
    expect(await robots.text()).toMatch(/User-agent: \*/);

    const icon = await worker.fetch(new Request('https://leadflow.test/favicon.svg'), { DB: db });
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toMatch(/image\/svg\+xml/);

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
