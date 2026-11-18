#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { fixedClock, systemClock } from '../clock.js';
import { loadConfig } from '../config.js';
import { openNodeSqlite } from '../db/node-sqlite.js';
import { bootstrap } from '../db/seed.js';
import { ConfigError } from '../domain/errors.js';
import { createLogger } from '../logger.js';
import { createLeadFlowServer } from '../mcp/server.js';

assertNode();

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
  logger.info('server.start', { transport: 'stdio', seeded, seed: config.seed });
  const handle = serveStdio(() =>
    createLeadFlowServer({
      repository,
      logger,
      clock,
      staleAfterDays: config.staleAfterDays,
    }),
  );
  const shutdown = (): void => {
    void handle.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    createLogger({ level: 'error' }).error('server.fatal', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
  process.exitCode = 1;
});

function assertNode(): void {
  const [majorText, minorText] = process.versions.node.split('.');
  const major = Number(majorText);
  const minor = Number(minorText);
  if (major < 22 || (major === 22 && minor < 13)) {
    console.error(
      `LeadFlow MCP requires Node.js >= 22.13 for built-in node:sqlite. This process is ${process.versions.node}.`,
    );
    process.exit(1);
  }
}
