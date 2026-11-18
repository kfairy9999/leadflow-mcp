import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/bin/stdio.js'],
  env: {
    ...getDefaultEnvironment(),
    LEADFLOW_DB: ':memory:',
    LEADFLOW_SEED: 'auto',
    LEADFLOW_NOW: '2026-11-18T15:00:00.000Z',
  },
  stderr: 'pipe',
});

const client = new Client(
  { name: 'ci', version: '0.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
await client.connect(transport);
try {
  const result = await client.callTool({ name: 'pipeline_summary', arguments: {} });
  const block = result.content[0];
  const text = block && 'text' in block ? block.text : '';
  if (!text.includes('Open: 8')) {
    console.error(text);
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
