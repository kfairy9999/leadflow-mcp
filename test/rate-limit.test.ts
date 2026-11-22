import { describe, expect, it } from 'vitest';

import { ConfigError } from '../src/domain/errors.js';
import { loadConfig } from '../src/config.js';
import type { IncomingMessage } from 'node:http';

import {
  createRateLimiter,
  parseRateLimitMax,
  parseRateLimitWindowMs,
  rateLimitHeaders,
  rateLimitKeyFromNodeRequest,
  rateLimitKeyFromRequest,
  rateLimitedResponse,
} from '../src/http/rate-limit.js';

describe('rate limiter', () => {
  it('allows traffic under the max and then returns 429 until the window slides', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 1_000 }, { now: () => now });

    const first = limiter.check('10.0.0.1');
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    const second = limiter.check('10.0.0.1');
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    const blocked = limiter.check('10.0.0.1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(limiter.check('10.0.0.2').allowed).toBe(true);

    now += 1_001;
    expect(limiter.check('10.0.0.1').allowed).toBe(true);
  });

  it('treats a max of 0 as unlimited and evicts old keys when the map is full', () => {
    const open = createRateLimiter({ maxRequests: 0, windowMs: 1_000 });
    expect(open.check('any').allowed).toBe(true);
    expect(open.check('any').limit).toBe(0);

    const tight = createRateLimiter({ maxRequests: 1, windowMs: 60_000 }, { maxKeys: 1 });
    expect(tight.check('a').allowed).toBe(true);
    expect(tight.check('b').allowed).toBe(true);
    // 'a' was evicted to make room for 'b'
    expect(tight.check('a').allowed).toBe(true);
  });

  it('reads the client key from forwarding headers and builds a 429 response', () => {
    const cf = new Request('https://leadflow.test/mcp', {
      headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' },
    });
    expect(rateLimitKeyFromRequest(cf)).toBe('203.0.113.9');
    const xff = new Request('https://leadflow.test/mcp', {
      headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' },
    });
    expect(rateLimitKeyFromRequest(xff)).toBe('198.51.100.2');
    expect(rateLimitKeyFromRequest(new Request('https://leadflow.test/mcp'))).toBe('unknown');
    expect(
      rateLimitKeyFromRequest(
        new Request('https://leadflow.test/mcp', { headers: { 'x-forwarded-for': ' , 10.0.0.1' } }),
      ),
    ).toBe('unknown');

    const nodeForwarded = {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage;
    expect(rateLimitKeyFromNodeRequest(nodeForwarded)).toBe('203.0.113.10');
    const nodeArray = {
      headers: { 'x-forwarded-for': ['198.51.100.8'] },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage;
    expect(rateLimitKeyFromNodeRequest(nodeArray)).toBe('198.51.100.8');
    const nodeSocket = {
      headers: {},
      socket: { remoteAddress: '::1' },
    } as unknown as IncomingMessage;
    expect(rateLimitKeyFromNodeRequest(nodeSocket)).toBe('::1');
    const nodeUnknown = {
      headers: { 'x-forwarded-for': [''] },
      socket: {},
    } as unknown as IncomingMessage;
    expect(rateLimitKeyFromNodeRequest(nodeUnknown)).toBe('unknown');

    const result = {
      allowed: false,
      limit: 60,
      remaining: 0,
      retryAfterSec: 12,
      resetAt: Date.now() + 12_000,
    };
    const headers = rateLimitHeaders(result, Date.now());
    expect(headers['retry-after']).toBe('12');
    expect(headers['rate-limit-remaining']).toBe('0');
    const response = rateLimitedResponse(result);
    expect(response.status).toBe(429);
  });

  it('parses rate-limit env and rejects out-of-range values', () => {
    expect(parseRateLimitMax(undefined)).toBe(60);
    expect(parseRateLimitMax('0')).toBe(0);
    expect(parseRateLimitMax('100000')).toBe(100_000);
    expect(() => parseRateLimitMax('nope')).toThrow(/LEADFLOW_RATE_LIMIT_MAX/);
    expect(() => parseRateLimitMax('100001')).toThrow(/LEADFLOW_RATE_LIMIT_MAX/);
    expect(parseRateLimitWindowMs(undefined)).toBe(60_000);
    expect(parseRateLimitWindowMs('1000')).toBe(1_000);
    expect(() => parseRateLimitWindowMs('999')).toThrow(/LEADFLOW_RATE_LIMIT_WINDOW_MS/);
    expect(() => parseRateLimitWindowMs('3600001')).toThrow(/LEADFLOW_RATE_LIMIT_WINDOW_MS/);
    expect(() => parseRateLimitWindowMs('abc')).toThrow(/LEADFLOW_RATE_LIMIT_WINDOW_MS/);

    const config = loadConfig({});
    expect(config.rateLimitMax).toBe(60);
    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(() => loadConfig({ LEADFLOW_RATE_LIMIT_MAX: 'nope' })).toThrow(ConfigError);
    expect(() => loadConfig({ LEADFLOW_RATE_LIMIT_WINDOW_MS: '10' })).toThrow(ConfigError);
    const custom = loadConfig({
      LEADFLOW_RATE_LIMIT_MAX: '5',
      LEADFLOW_RATE_LIMIT_WINDOW_MS: '2000',
    });
    expect(custom.rateLimitMax).toBe(5);
    expect(custom.rateLimitWindowMs).toBe(2_000);
  });
});
