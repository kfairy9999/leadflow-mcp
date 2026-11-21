import { createMcpHandler } from '@modelcontextprotocol/server';

import { bearerMatches, MIN_AUTH_TOKEN_LENGTH } from './auth.js';
import { systemClock } from './clock.js';
import { parseStaleDays } from './config.js';
import { D1SqlDatabase, type D1LikeDatabase } from './db/d1.js';
import { bootstrap } from './db/seed.js';
import { createLogger, parseLogLevel } from './logger.js';
import { FAVICON_SVG, PLAYGROUND_HTML, ROBOTS_TXT } from './demo/page.js';
import { createLeadFlowServer } from './mcp/server.js';
import { VERSION } from './version.js';

export interface LeadFlowEnv {
  DB: D1LikeDatabase;
  LEADFLOW_AUTH_TOKEN?: string;
  LEADFLOW_SEED?: string;
  LEADFLOW_STALE_DAYS?: string;
  LEADFLOW_LOG_LEVEL?: string;
}

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
} as const;

/**
 * Cloudflare Workers entry. The worker refuses MCP traffic until
 * LEADFLOW_AUTH_TOKEN is set, so a public *.workers.dev URL cannot serve
 * the lead database by accident. GET / (HTML playground), GET /api (JSON
 * metadata), and GET /health stay unauthenticated and return no lead data.
 */
const worker = {
  async fetch(request: Request, env: LeadFlowEnv): Promise<Response> {
    const url = new URL(request.url);
    const read = request.method === 'GET' || request.method === 'HEAD';
    if (read && url.pathname === '/health') {
      return send(
        request,
        JSON.stringify({ ok: true, service: 'leadflow-mcp', version: VERSION }),
        {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        },
      );
    }
    if (read && (url.pathname === '/api' || (url.pathname === '/' && prefersJson(request)))) {
      return send(request, JSON.stringify(serviceMetadata()), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    if (read && (url.pathname === '/' || url.pathname === '')) {
      return send(request, PLAYGROUND_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }
    if (read && url.pathname === '/robots.txt') {
      return send(request, ROBOTS_TXT, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=86400',
        },
      });
    }
    if (read && (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico')) {
      return send(request, FAVICON_SVG, {
        headers: {
          'content-type': 'image/svg+xml',
          'cache-control': 'public, max-age=86400',
        },
      });
    }
    if (url.pathname !== '/mcp') {
      return send(request, 'Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const denied = authorize(request, env.LEADFLOW_AUTH_TOKEN);
    if (denied) return denied;

    const logger = createLogger({ level: safeLevel(env.LEADFLOW_LOG_LEVEL) });
    const db = new D1SqlDatabase(env.DB);
    if (env.LEADFLOW_SEED === 'always') {
      logger.warn('seed.ignored', { cause: 'worker_rejects_always' });
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

function serviceMetadata() {
  return {
    service: 'leadflow-mcp',
    version: VERSION,
    description:
      'MCP server for a small-business lead pipeline: capture, score, follow up, and report.',
    endpoints: {
      health: '/health',
      api: '/api',
      mcp: '/mcp (Streamable HTTP, bearer token required)',
    },
    source: 'https://github.com/kfairy9999/leadflow-mcp',
  };
}

function prefersJson(request: Request): boolean {
  const accept = request.headers.get('accept');
  if (!accept) return false;
  const json = accept.indexOf('application/json');
  if (json === -1) return false;
  const html = accept.indexOf('text/html');
  return html === -1 || json < html;
}

function send(request: Request, body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(request.method === 'HEAD' ? null : body, { ...init, headers });
}

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
  } catch {
    return 7;
  }
}
