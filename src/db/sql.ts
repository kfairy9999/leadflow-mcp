export type SqlValue = string | number | null;

export interface SqlExecutor {
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>;
}

export interface SqlDatabase extends SqlExecutor {
  exec(sql: string): Promise<void>;
  /**
   * Runs `fn` without letting another caller use this database until it finishes.
   * On D1, writes inside `fn` are buffered and committed as one batch. Reads
   * inside that callback see only already-committed rows.
   */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): void;
}

export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return code.includes('SQLITE_CONSTRAINT') || /UNIQUE constraint failed/i.test(error.message);
}

export function isMissingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message);
}
