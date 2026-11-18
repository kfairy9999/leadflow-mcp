import { silenceSqliteExperimentalWarning } from './silence-sqlite-warning.js';
import type { SqlDatabase, SqlExecutor, SqlValue } from './sql.js';

interface StatementSync {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
  run(...params: SqlValue[]): { changes: number | bigint };
}

interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

/**
 * Adapter over Node's built-in SQLite. `DatabaseSync` is the Node 22 name;
 * newer Node releases keep it as an alias of `Database`.
 */
export async function openNodeSqlite(filename: string): Promise<SqlDatabase> {
  silenceSqliteExperimentalWarning();
  if (filename !== ':memory:') {
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(filename), { recursive: true });
  }
  const sqlite = (await import('node:sqlite')) as {
    DatabaseSync: new (path: string) => DatabaseSync;
  };
  const db = new sqlite.DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  return new NodeSqliteDatabase(db);
}

class NodeSqliteDatabase implements SqlDatabase {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DatabaseSync) {}

  all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.exclusive(() => this.allSync<T>(sql, params));
  }

  get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    return this.exclusive(() => this.getSync<T>(sql, params));
  }

  run(sql: string, params: readonly SqlValue[] = []): Promise<{ changes: number }> {
    return this.exclusive(() => this.runSync(sql, params));
  }

  exec(sql: string): Promise<void> {
    return this.exclusive(() => {
      this.db.exec(sql);
    });
  }

  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this.executor());
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // The original error is the one the caller can act on.
        }
        throw error;
      }
    });
  }

  close(): void {
    this.db.close();
  }

  private executor(): SqlExecutor {
    return {
      all: (sql, params = []) => Promise.resolve(this.allSync(sql, params)),
      get: (sql, params = []) => Promise.resolve(this.getSync(sql, params)),
      run: (sql, params = []) => Promise.resolve(this.runSync(sql, params)),
    };
  }

  private allSync<T>(sql: string, params: readonly SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private getSync<T>(sql: string, params: readonly SqlValue[]): T | undefined {
    const row = this.db.prepare(sql).get(...params);
    return (row ?? undefined) as T | undefined;
  }

  private runSync(sql: string, params: readonly SqlValue[]): { changes: number } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  private exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(
      () => fn(),
      () => fn(),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
