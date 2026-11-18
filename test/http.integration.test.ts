import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { startHttpServer } from '../src/http/serve.js';
import { connectHandler, isErrored, seededSqlite, textOf } from './helpers.js';
import type { Client } from '@modelcontextprotocol/client';

describe('streamable HTTP', () => {
  const closers: Array<() => Promise<void>> = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients) await client.close();
    clients.length = 0;
    for (const close of closers) await close();
    closers.length = 0;
  });

  it('serves health, hides other paths, and answers a tool call on loopback', async () => {
    const started = await seededSqlite('auto');
    const server = await startHttpServer({
      host: '127.0.0.1',
      port: 0,
      repository: started.repository,
      logger: started.logger,
      clock: started.clock,
      staleAfterDays: 7,
      authToken: null,
    });
    closers.push(server.close);

    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'leadflow-mcp' });
    expect((await fetch(`${server.url}/nope`)).status).toBe(404);

    const forbidden = await rawStatus(server.port, {
      host: 'evil.example',
      origin: undefined,
    });
    expect(forbidden).toBe(403);
    const foreignOrigin = await rawStatus(server.port, {
      host: `127.0.0.1:${server.port}`,
      origin: 'https://evil.example',
    });
    expect(foreignOrigin).toBe(403);

    const client = await connectHandler((url, init) => fetch(url, init), `${server.url}/mcp`);
    clients.push(client);
    const summary = await client.callTool({ name: 'pipeline_summary', arguments: {} });
    expect(isErrored(summary)).toBe(false);
    expect(textOf(summary)).toContain('Open: 8');
  });

  it('requires a bearer token when one is configured', async () => {
    const started = await seededSqlite('never');
    const token = '0123456789abcdef';
    const server = await startHttpServer({
      host: '127.0.0.1',
      port: 0,
      repository: started.repository,
      logger: started.logger,
      clock: started.clock,
      staleAfterDays: 7,
      authToken: token,
    });
    closers.push(server.close);

    const denied = await fetch(`${server.url}/mcp`, { method: 'POST' });
    expect(denied.status).toBe(401);
    const allowed = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(allowed.status).not.toBe(401);
  });
});

function rawStatus(
  port: number,
  headers: { host: string; origin: string | undefined },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          host: headers.host,
          ...(headers.origin ? { origin: headers.origin } : {}),
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}
