import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { fixedClock, type Clock } from '../src/clock.js';
import { D1SqlDatabase } from '../src/db/d1.js';
import { openNodeSqlite } from '../src/db/node-sqlite.js';
import { LeadRepository } from '../src/db/repository.js';
import { bootstrap } from '../src/db/seed.js';
import type { SeedMode } from '../src/config.js';
import type { SqlDatabase } from '../src/db/sql.js';
import { createLogger, type Logger } from '../src/logger.js';
import { createFakeD1 } from './fake-d1.js';

export const FIXED_NOW = new Date('2026-11-18T15:00:00.000Z');

export async function openSqlite(): Promise<SqlDatabase> {
  return openNodeSqlite(':memory:');
}

export async function openD1(): Promise<SqlDatabase> {
  return new D1SqlDatabase(await createFakeD1());
}

export async function bootstrapped(db: SqlDatabase, seed: SeedMode = 'never', now = FIXED_NOW) {
  const lines: string[] = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
  const clock = fixedClock(now);
  const started = await bootstrap(db, { seed, now: clock.now(), logger });
  return { ...started, logger, lines, clock, now };
}

export async function seededSqlite(seed: SeedMode = 'auto') {
  return bootstrapped(await openSqlite(), seed);
}

export function quietLogger(): Logger {
  return createLogger({ level: 'error', write: () => undefined });
}

export async function connectHandler(
  fetchImpl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
  url = 'http://leadflow.test/mcp',
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: fetchImpl });
  const client = new Client(
    { name: 'leadflow-test', version: '0.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(transport);
  return client;
}

export function textOf(result: { content?: unknown }): string {
  if (!Array.isArray(result.content) || result.content.length === 0) {
    throw new Error('Tool result had no content.');
  }
  const first: unknown = result.content[0];
  if (!first || typeof first !== 'object' || !('text' in first) || typeof first.text !== 'string') {
    throw new Error('Tool result content was not text.');
  }
  return first.text;
}

export function isErrored(result: { isError?: boolean | undefined }): boolean {
  return result.isError === true;
}

export function resourceText(content: { text?: string } | { blob?: string } | undefined): string {
  if (content && 'text' in content && typeof content.text === 'string') return content.text;
  return '';
}

export type { Clock, LeadRepository };
