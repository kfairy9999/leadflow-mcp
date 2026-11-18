import { describe, expect, it } from 'vitest';

import { bearerMatches, safeEqual } from '../src/auth.js';
import { loadConfig, parseSeedMode, parseStaleDays } from '../src/config.js';
import { ConfigError } from '../src/domain/errors.js';
import { createLogger, redact, redactString } from '../src/logger.js';

describe('logger', () => {
  it('drops debug when the level is info and redacts contact fields', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'info', write: (line) => lines.push(line) });
    logger.debug('tool.start', { tool: 'create_lead' });
    logger.info('tool.ok', {
      tool: 'create_lead',
      email: 'marina.cho@example.com',
      nested: { phone: '(555) 010-0101', note: 'reach marina.cho@example.com or (555) 010-0199' },
      createdAt: '2026-11-18T15:00:00.000Z',
    });
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).not.toContain('marina.cho@example.com');
    expect(line).not.toContain('555');
    expect(line).toContain('[redacted]');
    expect(line).toContain('[redacted-email]');
    expect(line).toContain('[redacted-phone]');
    expect(line).toContain('2026-11-18T15:00:00.000Z');
    expect(line).toContain('"tool":"create_lead"');
  });

  it('redacts bearer tokens and authorization keys', () => {
    expect(redactString('Authorization: Bearer super-secret-token')).toContain('Bearer [redacted]');
    expect(redact({ authorization: 'Bearer abc', token: 'abc' })).toEqual({
      authorization: '[redacted]',
      token: '[redacted]',
    });
  });
});

describe('config', () => {
  it('defaults to a local sqlite file, auto seed, and loopback HTTP', () => {
    const config = loadConfig({});
    expect(config.dbPath.endsWith('data/leadflow.sqlite')).toBe(true);
    expect(config.seed).toBe('auto');
    expect(config.httpHost).toBe('127.0.0.1');
    expect(config.httpPort).toBe(8787);
    expect(config.staleAfterDays).toBe(7);
    expect(config.authToken).toBeNull();
    expect(config.now).toBeNull();
  });

  it('rejects a public bind with no token and a short token', () => {
    expect(() => loadConfig({ LEADFLOW_HTTP_HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(() => loadConfig({ LEADFLOW_AUTH_TOKEN: 'short' })).toThrow(/16 characters/);
    expect(parseSeedMode('always')).toBe('always');
    expect(() => parseSeedMode('sometimes')).toThrow(ConfigError);
    expect(() => parseStaleDays('0')).toThrow(ConfigError);
    expect(() => loadConfig({ LEADFLOW_HTTP_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ LEADFLOW_NOW: 'yesterday' })).toThrow(ConfigError);
  });

  it('accepts a pinned clock and a long token', () => {
    const config = loadConfig({
      LEADFLOW_NOW: '2026-11-18T15:00:00.000Z',
      LEADFLOW_AUTH_TOKEN: '0123456789abcdef',
      LEADFLOW_DB: ':memory:',
    });
    expect(config.now?.toISOString()).toBe('2026-11-18T15:00:00.000Z');
    expect(config.authToken).toBe('0123456789abcdef');
    expect(config.dbPath).toBe(':memory:');
  });
});

describe('bearer compare', () => {
  it('matches only the exact token', () => {
    expect(safeEqual('abcdefghijklmnop', 'abcdefghijklmnop')).toBe(true);
    expect(safeEqual('abcdefghijklmnop', 'abcdefghijklmnoq')).toBe(false);
    expect(safeEqual('short', 'longer-token')).toBe(false);
    expect(bearerMatches('Bearer abcdefghijklmnop', 'abcdefghijklmnop')).toBe(true);
    expect(bearerMatches('Basic abcdefghijklmnop', 'abcdefghijklmnop')).toBe(false);
    expect(bearerMatches(null, 'abcdefghijklmnop')).toBe(false);
  });
});
