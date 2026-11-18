import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import { textOf } from '../helpers.js';

const root = new URL('../..', import.meta.url);
const stdioBin = new URL('../../dist/bin/stdio.js', import.meta.url);
const httpBin = new URL('../../dist/bin/http.js', import.meta.url);
const TOKEN = '0123456789abcdef';

describe('built server', () => {
  it('drives the stdio build through an MCP client', async () => {
    expect(existsSync(stdioBin), 'run npm run build before test:e2e').toBe(true);
    const stderr: Buffer[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [stdioBin.pathname],
      cwd: root.pathname,
      env: {
        ...getDefaultEnvironment(),
        LEADFLOW_DB: ':memory:',
        LEADFLOW_SEED: 'never',
        LEADFLOW_NOW: '2026-11-18T15:00:00.000Z',
        LEADFLOW_LOG_LEVEL: 'info',
      },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(Buffer.from(chunk));
    });
    const client = new Client(
      { name: 'leadflow-e2e-stdio', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(11);
      const empty = await client.callTool({ name: 'pipeline_summary', arguments: {} });
      expect(textOf(empty)).toContain('Open: 0');
      const created = await client.callTool({
        name: 'create_lead',
        arguments: {
          contactName: '=cmd',
          service: 'José, "leak"\nupstairs',
          source: 'referral',
          email: 'e2e.stdio@example.com',
          idempotencyKey: 'e2e-stdio-key1',
        },
      });
      expect(textOf(created)).toContain('Replay: no');
      const replay = await client.callTool({
        name: 'create_lead',
        arguments: {
          contactName: '=cmd',
          service: 'José, "leak"\nupstairs',
          source: 'referral',
          email: 'e2e.stdio@example.com',
          idempotencyKey: 'e2e-stdio-key1',
        },
      });
      expect(textOf(replay)).toContain('Replay: yes');
      const leadId = /lead_[a-z0-9]+/.exec(textOf(created))?.[0];
      if (!leadId) throw new Error(textOf(created));
      const scheduled = await client.callTool({
        name: 'schedule_follow_up',
        arguments: {
          leadId,
          dueAt: '2026-11-18T16:00:00+01:00',
          reason: 'Built server.',
        },
      });
      expect(textOf(scheduled)).toContain('2026-11-18T15:00:00.000Z');
      const due = await client.callTool({ name: 'list_due_follow_ups', arguments: {} });
      expect(textOf(due)).toContain('1 follow-up due');
      const csv = await client.callTool({ name: 'export_leads_csv', arguments: {} });
      expect(textOf(csv)).toContain("'=cmd");
      expect(textOf(csv)).toContain('"José, ""leak""');
    } finally {
      await client.close();
    }
    const logs = Buffer.concat(stderr).toString('utf8');
    expect(logs).toContain('server.start');
    expect(logs).not.toContain('e2e.stdio@example.com');
    expect(logs).not.toContain('José');
  });

  it('rejects a bad stdio config before speaking the protocol', async () => {
    const { code, stderr } = await runUntilExit(stdioBin.pathname, {
      LEADFLOW_DB: ':memory:',
      LEADFLOW_STALE_DAYS: '0',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('LEADFLOW_STALE_DAYS');
  });

  it('requires the bearer token on the built HTTP server', async () => {
    expect(existsSync(httpBin)).toBe(true);
    const child = spawn(process.execPath, [httpBin.pathname], {
      cwd: root.pathname,
      env: {
        ...process.env,
        LEADFLOW_DB: ':memory:',
        LEADFLOW_SEED: 'auto',
        LEADFLOW_NOW: '2026-11-18T15:00:00.000Z',
        LEADFLOW_HTTP_HOST: '127.0.0.1',
        LEADFLOW_HTTP_PORT: '0',
        LEADFLOW_AUTH_TOKEN: TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = await readPort(child);
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' });
      expect(denied.status).toBe(401);
      expect(await denied.text()).not.toContain('Open:');
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);

      const client = new Client(
        { name: 'leadflow-e2e-http', version: '0.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
        }),
      );
      try {
        const summary = await client.callTool({ name: 'pipeline_summary', arguments: {} });
        expect(textOf(summary)).toContain('Open: 8');
      } finally {
        await client.close();
      }
    } finally {
      child.kill('SIGTERM');
      await onceExit(child);
    }
  });

  it('refuses a public HTTP bind with no token', async () => {
    const { code, stderr } = await runUntilExit(httpBin.pathname, {
      LEADFLOW_DB: ':memory:',
      LEADFLOW_HTTP_HOST: '0.0.0.0',
      LEADFLOW_HTTP_PORT: '0',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('LEADFLOW_AUTH_TOKEN');
  });
});

function runUntilExit(
  script: string,
  env: Record<string, string>,
): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(process.execPath, [script], {
    cwd: root.pathname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stderr: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

function readPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`HTTP server did not log a port.\n${stderr}`));
    }, 10_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      const match = /"port":(\d+)/.exec(stderr);
      if (!match?.[1]) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`HTTP server exited ${code} before logging a port.\n${stderr}`));
    });
  });
}

function onceExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
  });
}
