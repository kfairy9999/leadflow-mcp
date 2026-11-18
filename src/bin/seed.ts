#!/usr/bin/env node
import { fixedClock, systemClock } from '../clock.js';
import { loadConfig } from '../config.js';
import { openNodeSqlite } from '../db/node-sqlite.js';
import { bootstrap } from '../db/seed.js';
import { ConfigError } from '../domain/errors.js';
import { createLogger } from '../logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const clock = config.now ? fixedClock(config.now) : systemClock;
  const mode = config.seed === 'never' ? 'auto' : config.seed;
  const db = await openNodeSqlite(config.dbPath);
  const { seeded } = await bootstrap(db, { seed: mode, now: clock.now(), logger });
  logger.info('seed.command', { seeded, mode });
  db.close();
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else {
    createLogger({ level: 'error' }).error('seed.fatal', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
  process.exitCode = 1;
});
