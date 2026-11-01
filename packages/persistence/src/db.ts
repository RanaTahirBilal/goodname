/**
 * Database connection and migration runner.
 *
 * Migrations are applied in order inside a transaction and recorded, so a
 * half-applied schema is not a state this can reach. Nothing here edits data
 * to make a migration succeed.
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema.ts';

export type Db = DatabaseSync;

export interface OpenOptions {
  /** A file path, or ':memory:' for tests. */
  location: string;
}

export function open({ location }: OpenOptions): Db {
  const db = new DatabaseSync(location);

  // Foreign keys are off by default in SQLite, which would make every
  // REFERENCES clause in the schema decorative.
  db.exec('PRAGMA foreign_keys = ON');
  // WAL keeps readers from blocking on a write, which matters as soon as a
  // request renders a report while a scan is being written.
  db.exec('PRAGMA journal_mode = WAL');

  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => Number((r as { version: number }).version))
  );

  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;

    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT');
      count++;
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`
      );
    }
  }

  return count;
}

/** Runs `fn` in a transaction, rolling back on any throw. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Short, sortable, collision-resistant enough for a row id. */
export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export const toJson = (v: unknown): string => JSON.stringify(v ?? null);

export const fromJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (s === null || s === undefined) return fallback;
  try {
    const parsed = JSON.parse(s);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
};

export const bool = (v: unknown): boolean => v === 1 || v === true;
