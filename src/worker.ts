import { createMcpHandler } from '@modelcontextprotocol/server';

import { bearerMatches, MIN_AUTH_TOKEN_LENGTH } from './auth.js';
import { systemClock } from './clock.js';
import { parseStaleDays } from './config.js';
import { D1SqlDatabase, type D1LikeDatabase } from './db/d1.js';
import { bootstrap } from './db/seed.js';
import { ConfigError } from './domain/errors.js';
import { createLogger, parseLogLevel } from './logger.js';
import { createLeadFlowServer } from './mcp/server.js';
import { VERSION } from './version.js';

export interface LeadFlowEnv {
  DB: D1LikeDatabase;
  LEADFLOW_AUTH_TOKEN?: string;
  LEADFLOW_SEED?: string;
  LEADFLOW_STALE_DAYS?: string;
  LEADFLOW_LOG_LEVEL?: string;
}

/**
 * Cloudflare Workers entry. The worker refuses MCP traffic until
 * LEADFLOW_AUTH_TOKEN is set, so a public *.workers.dev URL cannot serve
 * the lead database by accident. GET /health stays unauthenticated and
 * returns no lead data.
 */
const worker = {
  async fetch(request: Request, env: LeadFlowEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'leadflow-mcp', version: VERSION });
    }
    if (url.pathname !== '/mcp') {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const denied = authorize(request, env.LEADFLOW_AUTH_TOKEN);
    if (denied) return denied;

    const logger = createLogger({ level: safeLevel(env.LEADFLOW_LOG_LEVEL) });
    const db = new D1SqlDatabase(env.DB);
    if (env.LEADFLOW_SEED === 'always') {
      logger.warn('seed.ignored', { reason: 'worker_rejects_always' });
    }
    const seeded = await bootstrap(db, {
      seed: env.LEADFLOW_SEED === 'never' ? 'never' : 'auto',
      now: new Date(),
      logger,
    });
    const handler = createMcpHandler(() =>
      createLeadFlowServer({
        repository: seeded.repository,
        logger,
        clock: systemClock,
        staleAfterDays: safeStaleDays(env.LEADFLOW_STALE_DAYS),
      }),
    );
    return handler.fetch(request);
  },
};

export default worker;

function authorize(request: Request, token: string | undefined): Response | null {
  if (!token || token.trim().length < MIN_AUTH_TOKEN_LENGTH) {
    return new Response(
      'LeadFlow refuses to serve until LEADFLOW_AUTH_TOKEN is set to at least 16 characters.',
      {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      },
    );
  }
  if (!bearerMatches(request.headers.get('authorization'), token.trim())) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': 'Bearer',
        'cache-control': 'no-store',
      },
    });
  }
  return null;
}

function safeLevel(value: string | undefined) {
  try {
    return parseLogLevel(value);
  } catch {
    return 'info' as const;
  }
}

function safeStaleDays(value: string | undefined): number {
  try {
    return parseStaleDays(value);
  } catch (error) {
    if (error instanceof ConfigError) return 7;
    return 7;
  }
}
