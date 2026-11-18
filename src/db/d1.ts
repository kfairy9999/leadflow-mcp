import type { SqlDatabase, SqlExecutor, SqlValue } from './sql.js';

/** Structural subset of Cloudflare D1 used by LeadFlow. */
export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  all<T>(): Promise<{ results?: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1LikeDatabase {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<unknown>;
  batch(statements: D1PreparedStatement[]): Promise<Array<{ meta?: { changes?: number } }>>;
}

/**
 * D1 has no interactive transactions. Writes issued through `transaction()`
 * are sent as one `batch()`, which D1 commits atomically. Reads in that
 * callback do not see those pending writes. Repository methods do not
 * read their own uncommitted rows.
 */
export class D1SqlDatabase implements SqlDatabase {
  constructor(private readonly db: D1LikeDatabase) {}

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return result.results ?? [];
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | undefined> {
    const row = await this.db
      .prepare(sql)
      .bind(...params)
      .first<T>();
    return row ?? undefined;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<{ changes: number }> {
    const result = await this.db
      .prepare(sql)
      .bind(...params)
      .run();
    return { changes: result.meta?.changes ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const queued: D1PreparedStatement[] = [];
    const tx: SqlExecutor = {
      all: (sql, params) => this.all(sql, params),
      get: (sql, params) => this.get(sql, params),
      run: (sql, params = []) => {
        queued.push(this.db.prepare(sql).bind(...params));
        return Promise.resolve({ changes: 0 });
      },
    };
    const result = await fn(tx);
    if (queued.length > 0) await this.db.batch(queued);
    return result;
  }

  close(): void {
    // D1 connections are owned by the Workers runtime.
  }
}
