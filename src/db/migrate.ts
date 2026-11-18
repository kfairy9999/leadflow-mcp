import { MIGRATIONS } from './migrations.js';
import { isMissingTable, isUniqueViolation, type SqlDatabase } from './sql.js';

export async function migrate(db: SqlDatabase, now: Date = new Date()): Promise<string[]> {
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (!(await isPending(db, migration.version))) continue;
    await db.exec(migration.sql);
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
