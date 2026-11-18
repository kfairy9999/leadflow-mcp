import { MIGRATIONS } from './migrations.js';
import { isMissingTable, isUniqueViolation, type SqlDatabase } from './sql.js';

/**
 * D1's `exec` ends a statement at a newline. A formatted `CREATE TABLE` then
 * fails as incomplete input, and the Worker never finishes bootstrapping.
 * Split on semicolons and flatten whitespace. The SQL has no string literals
 * that contain either.
 */
export function statementsOf(script: string): string[] {
  return script
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0);
}

export async function migrate(db: SqlDatabase, now: Date = new Date()): Promise<string[]> {
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (!(await isPending(db, migration.version))) continue;
    for (const statement of statementsOf(migration.sql)) {
      await db.exec(statement);
    }
    try {
      await db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        now.toISOString(),
      ]);
      applied.push(migration.name);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return applied;
}

async function isPending(db: SqlDatabase, version: number): Promise<boolean> {
  try {
    const row = await db.get<{ version: number }>(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [version],
    );
    return row === undefined;
  } catch (error) {
    if (isMissingTable(error)) return true;
    throw error;
  }
}
