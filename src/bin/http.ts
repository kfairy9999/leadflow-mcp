#!/usr/bin/env node
import { fixedClock, systemClock } from '../clock.js';
import { loadConfig } from '../config.js';
import { openNodeSqlite } from '../db/node-sqlite.js';
import { bootstrap } from '../db/seed.js';
import { ConfigError } from '../domain/errors.js';
import { startHttpServer } from '../http/serve.js';
import { createLogger } from '../logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const clock = config.now ? fixedClock(config.now) : systemClock;
  const db = await openNodeSqlite(config.dbPath);
  const { repository, seeded } = await bootstrap(db, {
    seed: config.seed,
    now: clock.now(),
    logger,
  });
  const running = await startHttpServer({
    host: config.httpHost,
    port: config.httpPort,
    repository,
    logger,
    clock,
    staleAfterDays: config.staleAfterDays,
    authToken: config.authToken,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
  logger.info('server.start', {
    transport: 'http',
    seeded,
    seed: config.seed,
    port: running.port,
    auth: config.authToken ? 'bearer' : 'loopback',
  });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else {
    createLogger({ level: 'error' }).error('server.fatal', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
  process.exitCode = 1;
});
