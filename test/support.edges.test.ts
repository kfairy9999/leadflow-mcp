import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertAuthToken, bearerMatches } from '../src/auth.js';
import { isLoopbackHost, loadConfig, parseSeedMode, parseStaleDays } from '../src/config.js';
import { csvField, leadsToCsv } from '../src/domain/csv.js';
import { requestHash, stableStringify } from '../src/domain/hash.js';
import { formatUsd } from '../src/domain/money.js';
import {
  daysSinceActivity,
  formatWinRate,
  stageOrder,
  summarizePipeline,
  withScore,
} from '../src/domain/pipeline.js';
import { ageInDays, canonicalInstant, hoursAfter, hoursBefore } from '../src/domain/time.js';
import type { LeadActivity } from '../src/domain/types.js';
import { D1SqlDatabase, type D1LikeDatabase, type D1PreparedStatement } from '../src/db/d1.js';
import { migrate } from '../src/db/migrate.js';
import { openNodeSqlite } from '../src/db/node-sqlite.js';
import { createFakeD1 } from './fake-d1.js';
import { buildSeed } from '../src/db/seed.js';
import { silenceSqliteExperimentalWarning } from '../src/db/silence-sqlite-warning.js';
import {
  isForeignKeyViolation,
  isMissingTable,
  isUniqueViolation,
  type SqlDatabase,
} from '../src/db/sql.js';
import { createId } from '../src/ids.js';
import { createLogger, parseLogLevel, redact, redactString } from '../src/logger.js';
import { formatDue, formatPipeline, formatPoints } from '../src/mcp/format.js';
import { FIXED_NOW, bootstrapped, openSqlite } from './helpers.js';

const NOW = new Date('2026-11-18T15:00:00.000Z');

function activity(partial: Partial<LeadActivity> & Pick<LeadActivity, 'id'>): LeadActivity {
  return {
    contactName: partial.id,
    phone: null,
    email: null,
    service: 'Leak',
    source: 'other',
    stage: 'new',
    estimatedValueCents: 100,
    urgency: 'low',
    city: null,
    notes: null,
    createdAt: '2026-10-01T15:00:00.000Z',
    updatedAt: '2026-10-01T15:00:00.000Z',
    lastInteractionAt: null,
    ...partial,
  };
}

describe('canonical time', () => {
  it('normalizes offset spellings and rejects an unreadable one', () => {
    expect(canonicalInstant('2026-11-18T16:00:00+01:00')).toBe('2026-11-18T15:00:00.000Z');
    expect(canonicalInstant('2026-11-18T15:00:00Z')).toBe('2026-11-18T15:00:00.000Z');
    expect(canonicalInstant('2026-11-18T15:00:00.000Z')).toBe('2026-11-18T15:00:00.000Z');
    expect(() => canonicalInstant('tomorrow')).toThrow(/Cannot read datetime/);
    expect(ageInDays('not-a-date', NOW)).toBeNull();
    expect(ageInDays('2026-11-19T15:00:00.000Z', NOW)).toBe(0);
    expect(hoursBefore(NOW, 1)).toBe('2026-11-18T14:00:00.000Z');
    expect(hoursAfter(NOW, 1)).toBe('2026-11-18T16:00:00.000Z');
  });
});

describe('hash', () => {
  it('canonicalizes objects, arrays, and values JSON cannot spell', () => {
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('a')).toBe('"a"');
    expect(stableStringify([1, { b: 1, a: undefined }])).toBe('[1,{"b":1}]');
    expect(stableStringify(Symbol('x'))).toBe('null');
    const hashed = requestHash({ b: 1, a: 'x' });
    expect(hashed).toBe(createHash('sha256').update('{"a":"x","b":1}').digest('hex'));
    expect(hashed).toHaveLength(64);
  });
});

describe('csv formula and quoting', () => {
  it('neutralizes triggers after whitespace and quotes the dangerous cells', () => {
    expect(csvField(undefined)).toBe('');
    expect(csvField(0)).toBe('0');
    expect(csvField(' hello')).toBe(' hello');
    expect(csvField(' =1+1')).toBe("' =1+1");
    expect(csvField('  +1')).toBe("'  +1");
    expect(csvField(' -2')).toBe("' -2");
    expect(csvField(' @sum')).toBe("' @sum");
    expect(csvField('\n=cmd')).toBe('"\'\n=cmd"');
    expect(csvField('\t')).toBe("'\t");
    expect(csvField('\r')).toBe('"\'\r"');
    expect(csvField('=1,2')).toBe(`"'=1,2"`);
    expect(csvField('say "hi"\r\nnext')).toBe('"say ""hi""\r\nnext"');
    const csv = leadsToCsv([], NOW);
    expect(csv).toBe(
      'id,contact_name,phone,email,service,source,stage,estimated_value_cents,urgency,city,score,band,notes,created_at,updated_at,last_interaction_at\n',
    );
  });
});

describe('pipeline edges', () => {
  it('orders equal-age stale leads by id, caps the list, and skips a broken timestamp', () => {
    const leads = [
      activity({ id: 'b', createdAt: 'not-a-date' }),
      activity({ id: 'won', stage: 'won', estimatedValueCents: 9_999 }),
      ...Array.from({ length: 51 }, (_, index) =>
        activity({ id: `s${index.toString().padStart(2, '0')}` }),
      ),
    ];
    const summary = summarizePipeline(leads, NOW, 7);
    expect(summary.staleCount).toBe(51);
    expect(summary.staleTruncated).toBe(true);
    expect(summary.staleLeads).toHaveLength(50);
    expect(summary.staleLeads[0]?.id).toBe('s00');
    expect(summary.staleLeads[49]?.id).toBe('s49');
    expect(summary.staleLeads.map((lead) => lead.id)).not.toContain('b');
    expect(summary.openValueCents).toBe(52 * 100);
    expect(summary.winRateLabel).toBe('1/1 (100.0%)');
    expect(daysSinceActivity(activity({ id: 'broken', createdAt: 'nope' }), NOW)).toBeNull();
    expect(withScore(activity({ id: 'scored', stage: 'won' }), NOW).band).toBe('cold');
    expect(stageOrder()).toEqual(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']);
    expect(formatWinRate(1, 2)).toBe('1/3 (33.3%)');
    expect(formatWinRate(2, 1)).toBe('2/3 (66.7%)');
    expect(formatWinRate(0, 1)).toBe('0/1 (0.0%)');
    expect(formatUsd(1)).toBe('$0.01');
    expect(formatUsd(100_000)).toBe('$1,000.00');
  });

  it('formats an empty due list, a single item, and a truncated stale list', () => {
    expect(formatDue([], NOW.toISOString())).toBe(`No follow-ups due as of ${NOW.toISOString()}.`);
    expect(
      formatDue(
        [
          {
            id: 'fu_one',
            leadId: 'lead_one',
            dueAt: NOW.toISOString(),
            reason: 'Call',
            status: 'scheduled',
            createdAt: NOW.toISOString(),
            contactName: 'Ada',
            service: 'Leak',
            stage: 'new',
            phone: null,
            email: null,
          },
        ],
        NOW.toISOString(),
      ),
    ).toContain('1 follow-up due');
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(-4)).toBe('-4');
    const summary = summarizePipeline(
      Array.from({ length: 51 }, (_, index) => activity({ id: `t${index}` })),
      NOW,
      1,
    );
    expect(formatPipeline(summary)).toContain('(list truncated)');
  });
});

describe('sql error classes', () => {
  it('recognizes constraint text and ignores non-errors', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(
      isUniqueViolation(Object.assign(new Error('other'), { code: 'SQLITE_CONSTRAINT' })),
    ).toBe(true);
    expect(isUniqueViolation(new Error('UNIQUE constraint failed: leads.id'))).toBe(true);
    expect(isForeignKeyViolation('FOREIGN KEY constraint failed')).toBe(false);
    expect(isForeignKeyViolation(new Error('FOREIGN KEY constraint failed'))).toBe(true);
    expect(isMissingTable(new Error('no such table: schema_migrations'))).toBe(true);
    expect(isMissingTable(new Error('disk I/O'))).toBe(false);
  });
});

describe('ids, auth, config, logger', () => {
  it('rejects a bad id prefix and a short auth token', () => {
    expect(createId('lead')).toMatch(/^lead_[0-9a-f]{16}$/);
    expect(() => createId('NO' as 'lead')).toThrow(/prefix/);
    expect(() => assertAuthToken('short')).toThrow(/16 characters/);
    expect(() => assertAuthToken('0123456789abcdef')).not.toThrow();
    expect(bearerMatches('Bearer ', '0123456789abcdef')).toBe(false);
    expect(bearerMatches('Bearer   0123456789abcdef  ', '0123456789abcdef')).toBe(true);
    expect(bearerMatches(undefined, '0123456789abcdef')).toBe(false);
  });

  it('parses the remaining config edges', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(parseSeedMode(undefined)).toBe('auto');
    expect(parseSeedMode('')).toBe('auto');
    expect(parseSeedMode('never')).toBe('never');
    expect(parseStaleDays(undefined)).toBe(7);
    expect(parseStaleDays(' 12 ')).toBe(12);
    expect(() => parseStaleDays('nope')).toThrow(/1 to 90/);
    expect(() => parseStaleDays('91')).toThrow(/1 to 90/);
    const config = loadConfig({
      LEADFLOW_HTTP_HOST: '::1',
      LEADFLOW_HTTP_PORT: '0',
      LEADFLOW_STALE_DAYS: '90',
      LEADFLOW_LOG_LEVEL: 'debug',
      LEADFLOW_AUTH_TOKEN: '  0123456789abcdef  ',
      LEADFLOW_SEED: 'never',
    });
    expect(config.httpHost).toBe('::1');
    expect(config.httpPort).toBe(0);
    expect(config.staleAfterDays).toBe(90);
    expect(config.logLevel).toBe('debug');
    expect(config.authToken).toBe('0123456789abcdef');
    expect(config.seed).toBe('never');
    expect(() => loadConfig({ LEADFLOW_HTTP_PORT: 'nope' })).toThrow(/PORT/);
    expect(() => loadConfig({ LEADFLOW_LOG_LEVEL: 'loud' })).toThrow(/LEADFLOW_LOG_LEVEL/);
    expect(() => loadConfig({ LEADFLOW_HTTP_HOST: '10.0.0.8', LEADFLOW_AUTH_TOKEN: '' })).toThrow(
      /unauthenticated/,
    );
    expect(parseLogLevel(undefined)).toBe('info');
    expect(parseLogLevel('warn')).toBe('warn');
    expect(parseLogLevel('error')).toBe('error');
  });

  it('redacts nested values and writes the default sink', () => {
    expect(redactString('plain')).toBe('plain');
    let nested: unknown = { phone: '555' };
    for (let depth = 0; depth < 9; depth += 1) nested = { child: nested };
    expect(JSON.stringify(redact(nested))).toContain('[truncated]');
    expect(redact(['ada@example.com', { notes: 'secret' }, true])).toEqual([
      '[redacted-email]',
      { notes: '[redacted]' },
      true,
    ]);
    expect(redact(Symbol('x'))).toBe('[unloggable]');
    expect(redact(undefined)).toBeUndefined();
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug',
      write: (line) => lines.push(line),
      base: { service: 'leadflow' },
    });
    logger.debug('debug.event', { list: [1] });
    logger.warn('warn.event');
    logger.error('error.event');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"service":"leadflow"');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createLogger().info('default.sink');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('sqlite driver and seed race', () => {
  const files: string[] = [];

  afterEach(async () => {
    await Promise.all(files.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates a file database, reads inside a transaction, and forwards ordinary warnings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'leadflow-'));
    files.push(root);
    const db = await openNodeSqlite(path.join(root, 'nested', 'lead.sqlite'));
    await db.exec('CREATE TABLE rows (n INTEGER)');
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO rows (n) VALUES (1)');
      const rows = await tx.all<{ n: number }>('SELECT n FROM rows');
      expect(rows).toEqual([{ n: 1 }]);
    });
    db.close();

    silenceSqliteExperimentalWarning();
    const seen: string[] = [];
    const onWarning = (warning: Error): void => {
      seen.push(`${warning.name}:${warning.message}`);
    };
    process.on('warning', onWarning);
    process.emitWarning('SQLite is experimental', 'ExperimentalWarning');
    process.emitWarning('ordinary notice', 'Warning');
    await new Promise((resolve) => setImmediate(resolve));
    process.off('warning', onWarning);
    expect(seen.join('\n')).not.toContain('SQLite');
    expect(seen.join('\n')).toContain('ordinary notice');
  });

  it('treats a second auto-seed as a lost race when the count still looks empty', async () => {
    const db = await openSqlite();
    const lying = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'get') {
          return async (sql: string, params?: readonly (string | number | null)[]) => {
            if (sql.includes('COUNT(*)')) return { n: 0 };
            return target.get(sql, params);
          };
        }
        return bindMember(Reflect.get(target, prop, receiver), target);
      },
    });
    const first = await bootstrapped(lying, 'auto');
    expect(first.seeded).toBe(true);
    const second = await bootstrapped(lying, 'auto');
    expect(second.seeded).toBe(false);
    expect(second.lines.join('\n')).toContain('concurrent_insert');
    expect(buildSeed(FIXED_NOW).interactions.length).toBeGreaterThan(0);
    db.close();
  });
});

describe('migration faults', () => {
  it('swallows a unique race and rethrows anything else', async () => {
    const db = await openSqlite();
    const unique = Object.assign(new Error('UNIQUE constraint failed: schema_migrations.version'), {
      code: 'SQLITE_CONSTRAINT',
    });
    const raced = scripted(db, {
      pending: () => Promise.resolve(undefined),
      insert: () => Promise.reject(unique),
    });
    await expect(migrate(raced, FIXED_NOW)).resolves.toEqual([]);

    const exploded = scripted(db, {
      pending: () => Promise.reject(new Error('disk I/O error')),
    });
    await expect(migrate(exploded, FIXED_NOW)).rejects.toThrow(/disk I\/O error/);

    const badInsert = scripted(db, {
      pending: () => Promise.resolve(undefined),
      insert: () => Promise.reject(new Error('readonly')),
    });
    await expect(migrate(badInsert, FIXED_NOW)).rejects.toThrow(/readonly/);
    db.close();
  });
});

describe('d1 adapter edges', () => {
  it('reads committed rows inside a transaction and tolerates a sparse result', async () => {
    const db = new D1SqlDatabase(await createFakeD1());
    await db.exec('CREATE TABLE nums (n INTEGER)');
    await db.run('INSERT INTO nums (n) VALUES (1)');
    const seen = await db.transaction(async (tx) => {
      await tx.run('UPDATE nums SET n = 2');
      return {
        row: await tx.get<{ n: number }>('SELECT n FROM nums'),
        rows: await tx.all<{ n: number }>('SELECT n FROM nums'),
      };
    });
    expect(seen.row?.n).toBe(1);
    expect(seen.rows).toEqual([{ n: 1 }]);
    expect(await db.get<{ n: number }>('SELECT n FROM nums')).toEqual({ n: 2 });
    expect(await db.transaction(() => Promise.resolve(7))).toBe(7);
    db.close();

    const sparse = new D1SqlDatabase(sparseD1());
    expect(await sparse.all('select 1')).toEqual([]);
    expect(await sparse.get('select 1')).toBeUndefined();
    expect(await sparse.run('update t set n = 1')).toEqual({ changes: 0 });
    sparse.close();
  });

  it('sees its own writes inside a node:sqlite transaction', async () => {
    const db = await openSqlite();
    await db.exec('CREATE TABLE nums (n INTEGER)');
    await db.run('INSERT INTO nums (n) VALUES (1)');
    const seen = await db.transaction(async (tx) => {
      await tx.run('UPDATE nums SET n = 2');
      return tx.get<{ n: number }>('SELECT n FROM nums');
    });
    expect(seen?.n).toBe(2);
    db.close();
  });
});

function sparseD1(): D1LikeDatabase {
  const statement: D1PreparedStatement = {
    bind() {
      return statement;
    },
    all: () => Promise.resolve({}),
    first: () => Promise.resolve(null),
    run: () => Promise.resolve({}),
  };
  return {
    prepare: () => statement,
    exec: () => Promise.resolve(undefined),
    batch: () => Promise.resolve([]),
  };
}

function bindMember(value: unknown, target: object): unknown {
  if (typeof value !== 'function') return value;
  const member = value as (this: unknown, ...args: never[]) => unknown;
  return member.bind(target);
}

function scripted(
  db: SqlDatabase,
  hooks: {
    pending?: SqlDatabase['get'];
    insert?: SqlDatabase['run'];
  },
): SqlDatabase {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'get' && hooks.pending) {
        return (sql: string, params?: readonly (string | number | null)[]) => {
          if (sql.includes('schema_migrations')) return hooks.pending?.(sql, params);
          return target.get(sql, params);
        };
      }
      if (prop === 'run' && hooks.insert) {
        return (sql: string, params?: readonly (string | number | null)[]) => {
          if (sql.includes('INSERT INTO schema_migrations')) return hooks.insert?.(sql, params);
          return target.run(sql, params);
        };
      }
      return bindMember(Reflect.get(target, prop, receiver), target);
    },
  });
}
