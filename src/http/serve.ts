import { createServer, type IncomingMessage } from 'node:http';

import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';

import { bearerMatches } from '../auth.js';
import type { Clock } from '../clock.js';
import type { LeadRepository } from '../db/repository.js';
import type { Logger } from '../logger.js';
import { createLeadFlowServer } from '../mcp/server.js';
import { VERSION } from '../version.js';

export interface HttpServerOptions {
  host: string;
  port: number;
  repository: LeadRepository;
  logger: Logger;
  clock: Clock;
  staleAfterDays: number;
  authToken: string | null;
}

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;

export async function startHttpServer(options: HttpServerOptions): Promise<RunningServer> {
  const handler = createMcpHandler(() =>
    createLeadFlowServer({
      repository: options.repository,
      logger: options.logger,
      clock: options.clock,
      staleAfterDays: options.staleAfterDays,
    }),
  );
  const nodeHandler = toNodeHandler(handler, {
    maxRequestBodySize: MAX_BODY_BYTES,
    onerror: (error) => {
      options.logger.error('http.handler_error', { errorName: error.name });
    },
  });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const server = createServer((req, res) => {
    const url = parseRequestUrl(req);
    if (!url) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ ok: true, service: 'leadflow-mcp', version: VERSION }));
      return;
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    if (
      options.authToken &&
      !bearerMatches(headerValue(req.headers.authorization), options.authToken)
    ) {
      res.writeHead(401, {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': 'Bearer',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    // exactOptionalPropertyTypes disagrees with the SDK's node:http parameter types.
    const nodeReq = req as never;
    const nodeRes = res as never;
    if (!validateHost(nodeReq, nodeRes) || !validateOrigin(nodeReq, nodeRes)) return;
    void nodeHandler(nodeReq, nodeRes);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const hostForUrl = options.host === '::1' ? '[::1]' : options.host;
  return {
    url: `http://${hostForUrl}:${port}`,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function parseRequestUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    return null;
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
