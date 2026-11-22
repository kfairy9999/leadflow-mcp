import type { IncomingMessage, ServerResponse } from 'node:http';

export const DEFAULT_RATE_LIMIT_MAX = 60;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  resetAt: number;
};

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
};

/**
 * Fixed-window-style sliding counter: at most `maxRequests` hits per key
 * inside `windowMs`. A max of 0 disables the limiter (every check is allowed).
 * Used to rate-limit Streamable HTTP and Worker `/mcp` traffic.
 */
export function createRateLimiter(
  config: RateLimitConfig,
  options: { now?: () => number; maxKeys?: number } = {},
): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;
  const nowFn = options.now ?? Date.now;

  return {
    check(key: string): RateLimitResult {
      const now = nowFn();
      if (config.maxRequests <= 0) {
        return { allowed: true, limit: 0, remaining: 0, retryAfterSec: 0, resetAt: now };
      }
      const windowStart = now - config.windowMs;
      const stamps = (hits.get(key) ?? []).filter((stamp) => stamp > windowStart);
      if (stamps.length >= config.maxRequests) {
        hits.set(key, stamps);
        const oldest = stamps[0] ?? now;
        const resetAt = oldest + config.windowMs;
        return {
          allowed: false,
          limit: config.maxRequests,
          remaining: 0,
          retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
          resetAt,
        };
      }
      if (!hits.has(key) && hits.size >= maxKeys) {
        const oldestKey = hits.keys().next().value;
        if (oldestKey !== undefined) hits.delete(oldestKey);
      }
      stamps.push(now);
      hits.set(key, stamps);
      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests - stamps.length,
        retryAfterSec: 0,
        resetAt: (stamps[0] ?? now) + config.windowMs,
      };
    },
  };
}

export function rateLimitHeaders(
  result: RateLimitResult,
  now = Date.now(),
): Record<string, string> {
  const resetSec = Math.max(0, Math.ceil((result.resetAt - now) / 1000));
  return {
    'rate-limit-limit': String(result.limit),
    'rate-limit-remaining': String(result.remaining),
    'rate-limit-reset': String(resetSec),
    ...(result.allowed ? {} : { 'retry-after': String(result.retryAfterSec) }),
  };
}

export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: 'rate_limited', retryAfterSec: result.retryAfterSec }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...rateLimitHeaders(result),
      },
    },
  );
}

export function writeRateLimited(res: ServerResponse, result: RateLimitResult): void {
  res.writeHead(429, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...rateLimitHeaders(result),
  });
  res.end(JSON.stringify({ error: 'rate_limited', retryAfterSec: result.retryAfterSec }));
}

export function rateLimitKeyFromRequest(request: Request, fallback = 'unknown'): string {
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return fallback;
}

export function rateLimitKeyFromNodeRequest(req: IncomingMessage, fallback = 'unknown'): string {
  const forwarded = headerValue(req.headers['x-forwarded-for']);
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? fallback;
}

export function parseRateLimitMax(
  value: string | undefined,
  fallback = DEFAULT_RATE_LIMIT_MAX,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error('LEADFLOW_RATE_LIMIT_MAX must be an integer from 0 to 100000.');
  }
  const parsed = Number(value);
  if (parsed > 100_000) {
    throw new Error('LEADFLOW_RATE_LIMIT_MAX must be an integer from 0 to 100000.');
  }
  return parsed;
}

export function parseRateLimitWindowMs(
  value: string | undefined,
  fallback = DEFAULT_RATE_LIMIT_WINDOW_MS,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error('LEADFLOW_RATE_LIMIT_WINDOW_MS must be an integer from 1000 to 3600000.');
  }
  const parsed = Number(value);
  if (parsed < 1000 || parsed > 3_600_000) {
    throw new Error('LEADFLOW_RATE_LIMIT_WINDOW_MS must be an integer from 1000 to 3600000.');
  }
  return parsed;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
