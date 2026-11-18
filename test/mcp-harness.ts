import { createMcpHandler } from '@modelcontextprotocol/server';
import { expect } from 'vitest';

import { createLeadFlowServer, type LeadFlowServices } from '../src/mcp/server.js';
import { connectHandler, seededSqlite, textOf } from './helpers.js';
import type { Client } from '@modelcontextprotocol/client';

export async function openLeadClient(seed: 'auto' | 'never' = 'never', staleAfterDays = 7) {
  const started = await seededSqlite(seed);
  const services: LeadFlowServices = {
    repository: started.repository,
    logger: started.logger,
    clock: started.clock,
    staleAfterDays,
  };
  const handler = createMcpHandler(() => createLeadFlowServer(services));
  const client = await connectHandler((url, init) => handler.fetch(new Request(url, init)));
  return {
    client,
    started,
    services,
    async close() {
      await client.close();
      await handler.close();
    },
  };
}

export function expectToolError(
  result: { isError: boolean; text: string },
  pattern: RegExp,
): string {
  expect(result.isError).toBe(true);
  expect(result.text).toMatch(pattern);
  return result.text;
}

export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: textOf(result) };
}
