import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';

import { textOf } from './helpers.js';

describe('stdio transport', () => {
  it('answers pipeline_summary from a spawned server and keeps PII off stderr', async () => {
    const stderr: Buffer[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/bin/stdio.ts'],
      cwd: new URL('..', import.meta.url).pathname,
      env: {
        ...getDefaultEnvironment(),
        LEADFLOW_DB: ':memory:',
        LEADFLOW_SEED: 'auto',
        LEADFLOW_NOW: '2026-11-18T15:00:00.000Z',
        LEADFLOW_LOG_LEVEL: 'info',
      },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(Buffer.from(chunk));
    });
    const client = new Client(
      { name: 'leadflow-stdio-test', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(transport);
    try {
      const summary = await client.callTool({ name: 'pipeline_summary', arguments: {} });
      expect(textOf(summary)).toContain('Open: 8');
      expect(textOf(summary)).toContain('$21,050.00');
    } finally {
      await client.close();
    }
    const logs = Buffer.concat(stderr).toString('utf8');
    expect(logs).not.toContain('example.com');
    expect(logs).not.toContain('555');
    expect(logs).toContain('server.start');
  });
});
