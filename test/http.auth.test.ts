import { request as httpRequest } from 'node:http';

import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { startHttpServer } from '../src/http/serve.js';
import { seededSqlite, textOf } from './helpers.js';

const TOKEN = '0123456789abcdef';
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers) await close();
  closers.length = 0;
});

describe('streamable HTTP auth', () => {
  it('rejects a missing, empty, or wrong bearer and accepts the real one', async () => {
    const started = await seededSqlite('auto');
    const server = await startHttpServer({
      host: '127.0.0.1',
      port: 0,
      repository: started.repository,
      logger: started.logger,
      clock: started.clock,
      staleAfterDays: 7,
      authToken: TOKEN,
    });
    closers.push(server.close);

    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
    expect(JSON.stringify(await health.json())).not.toContain('Marina');

    const cases = [
      undefined,
      'Bearer',
      'Bearer ',
      'Basic 0123456789abcdef',
      'Bearer wrong-token-value',
      'Bearer 0123456789abcdee',
    ];
    for (const authorization of cases) {
      const denied = await fetch(`${server.url}/mcp`, {
        method: 'POST',
        headers: {
          ...(authorization ? { authorization } : {}),
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toBe('Bearer');
      const body = await denied.text();
      expect(body).toContain('unauthorized');
      expect(body).not.toContain('Marina');
      expect(body).not.toContain('example.com');
    }

    const spaced = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer   ${TOKEN}  `,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(spaced.status).not.toBe(401);

    const rejected = new Client(
      { name: 'leadflow-denied', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await expect(
      rejected.connect(
        new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
          requestInit: { headers: { authorization: 'Bearer wrong-token-value' } },
        }),
      ),
    ).rejects.toThrow();

    const client = new Client(
      { name: 'leadflow-allowed', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
      }),
    );
    closers.push(() => client.close());
    const summary = await client.callTool({ name: 'pipeline_summary', arguments: {} });
    expect(textOf(summary)).toContain('Open: 8');
  });

  it('serves loopback IPv6 and rejects a host header that is not a URL', async () => {
    const started = await seededSqlite('never');
    const server = await startHttpServer({
      host: '::1',
      port: 0,
      repository: started.repository,
      logger: started.logger,
      clock: started.clock,
      staleAfterDays: 7,
      authToken: null,
    });
    closers.push(server.close);
    expect(server.url).toContain('[::1]');
    expect((await fetch(`${server.url}/health`)).status).toBe(200);
    expect(await rawStatus(server.port, 'not a host')).toBe(400);
    expect(await rawStatus(server.port, '127.0.0.1')).toBe(404);
  });
  it('rate-limits /mcp and leaves /health open', async () => {
    const started = await seededSqlite('auto');
    const server = await startHttpServer({
      host: '127.0.0.1',
      port: 0,
      repository: started.repository,
      logger: started.logger,
      clock: started.clock,
      staleAfterDays: 7,
      authToken: TOKEN,
      rateLimitMax: 2,
      rateLimitWindowMs: 60_000,
    });
    closers.push(server.close);

    const headers = { authorization: `Bearer ${TOKEN}` };
    const first = await fetch(`${server.url}/mcp`, { method: 'POST', headers });
    const second = await fetch(`${server.url}/mcp`, { method: 'POST', headers });
    const third = await fetch(`${server.url}/mcp`, { method: 'POST', headers });
    expect(first.status).not.toBe(429);
    expect(second.status).not.toBe(429);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBeTruthy();
    const body = (await third.json()) as { error: string };
    expect(body.error).toBe('rate_limited');

    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
  });
});

function rawStatus(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '::1',
        port,
        path: '/nope',
        method: 'GET',
        headers: { host },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}
