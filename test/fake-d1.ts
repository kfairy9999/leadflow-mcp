import type { D1LikeDatabase, D1PreparedStatement } from '../src/db/d1.js';
import { silenceSqliteExperimentalWarning } from '../src/db/silence-sqlite-warning.js';
import type { SqlValue } from '../src/db/sql.js';

interface StatementSync {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
  run(...params: SqlValue[]): { changes: number | bigint };
}

interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
}

export async function createFakeD1(): Promise<D1LikeDatabase> {
  silenceSqliteExperimentalWarning();
  const sqlite = (await import('node:sqlite')) as {
    DatabaseSync: new (path: string) => DatabaseSync;
  };
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return new FakeD1(db);
}

class BoundStatement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: readonly SqlValue[],
  ) {}

  bind(...values: SqlValue[]): D1PreparedStatement {
    return new BoundStatement(this.db, this.sql, values);
  }

  all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({ results: this.db.prepare(this.sql).all(...this.params) as T[] });
  }

  first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return Promise.resolve((row ?? null) as T | null);
  }

  run(): Promise<{ meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...this.params);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class FakeD1 implements D1LikeDatabase {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatement {
    return new BoundStatement(this.db, sql, []);
  }

  exec(sql: string): Promise<void> {
    return this.exclusive(() => {
      this.db.exec(sql);
    });
  }

  batch(statements: D1PreparedStatement[]): Promise<Array<{ meta?: { changes?: number } }>> {
    return this.exclusive(async () => {
      this.db.exec('BEGIN');
      try {
        const results: Array<{ meta?: { changes?: number } }> = [];
        for (const statement of statements) results.push(await statement.run());
        this.db.exec('COMMIT');
        return results;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  private exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
