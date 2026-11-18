import path from 'node:path';

import { ConfigError } from './domain/errors.js';
import { parseLogLevel, type LogLevel } from './logger.js';

export type SeedMode = 'auto' | 'always' | 'never';

export interface AppConfig {
  dbPath: string;
  seed: SeedMode;
  logLevel: LogLevel;
  httpHost: string;
  httpPort: number;
  staleAfterDays: number;
  now: Date | null;
  authToken: string | null;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const httpHost = env.LEADFLOW_HTTP_HOST?.trim() || '127.0.0.1';
  const authToken = readAuthToken(env.LEADFLOW_AUTH_TOKEN);
  if (!LOOPBACK.has(httpHost) && authToken === null) {
    throw new ConfigError(
      `Refusing to bind ${httpHost} without LEADFLOW_AUTH_TOKEN. Loopback is the only unauthenticated bind.`,
    );
  }
  return {
    dbPath: env.LEADFLOW_DB?.trim() || path.resolve(process.cwd(), 'data', 'leadflow.sqlite'),
    seed: parseSeedMode(env.LEADFLOW_SEED),
    logLevel: parseLevel(env.LEADFLOW_LOG_LEVEL),
    httpHost,
    httpPort: parsePort(env.LEADFLOW_HTTP_PORT),
    staleAfterDays: parseStaleDays(env.LEADFLOW_STALE_DAYS),
    now: parseNow(env.LEADFLOW_NOW),
    authToken,
  };
}

export function parseSeedMode(value: string | undefined): SeedMode {
  if (value === undefined || value.trim() === '' || value === 'auto') return 'auto';
  if (value === 'always' || value === 'never') return value;
  throw new ConfigError('LEADFLOW_SEED must be auto, always, or never.');
}

export function parseStaleDays(value: string | undefined, fallback = 7): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigError('LEADFLOW_STALE_DAYS must be an integer from 1 to 90.');
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 90) {
    throw new ConfigError('LEADFLOW_STALE_DAYS must be an integer from 1 to 90.');
  }
  return parsed;
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host);
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 8787;
  if (!/^\d+$/.test(value.trim()))
    throw new ConfigError('LEADFLOW_HTTP_PORT must be an integer from 0 to 65535.');
  const parsed = Number(value);
  if (parsed > 65535)
    throw new ConfigError('LEADFLOW_HTTP_PORT must be an integer from 0 to 65535.');
  return parsed;
}

function parseNow(value: string | undefined): Date | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new ConfigError('LEADFLOW_NOW must be an ISO-8601 datetime.');
  return parsed;
}

function parseLevel(value: string | undefined): LogLevel {
  try {
    return parseLogLevel(value);
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : 'Invalid log level.');
  }
}

function readAuthToken(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  if (value.trim().length < 16) {
    throw new ConfigError('LEADFLOW_AUTH_TOKEN must be at least 16 characters.');
  }
  return value.trim();
}
