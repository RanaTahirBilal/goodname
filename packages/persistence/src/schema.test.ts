import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { open } from './db.ts';
import { MIGRATIONS } from './schema.ts';

test('migration versions are unique and consecutive from 1', () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), 'migrations are out of order');
  assert.equal(new Set(versions).size, versions.length, 'duplicate migration version');
  assert.deepEqual(versions, versions.map((_, i) => i + 1), 'a version number is missing');
});

test('no migration SQL contains a backtick', () => {
  /**
   * Guards a mistake made twice in this file.
   *
   * The migrations are template literals, so a backtick used to quote a
   * column name in a comment — `attempts`, `email` — silently terminates
   * the string. The failure surfaces as a TypeScript parse error pointing at
   * the comment, which reads like a syntax problem in prose and sends you
   * looking in the wrong place.
   */
  for (const m of MIGRATIONS) {
    assert.ok(
      !m.sql.includes('`'),
      `migration ${m.version} (${m.name}) contains a backtick, which closes the template literal`
    );
  }
});

test('every migration applies to a fresh database', () => {
  const db = open({ location: ':memory:' });
  const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
  assert.equal(applied.length, MIGRATIONS.length);
});

test('every table holding customer data carries account_id', () => {
  const db = open({ location: ':memory:' });

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => (r as { name: string }).name);

  /**
   * The exceptions, each for a stated reason:
   *   - sign_in_tokens is keyed on an email before any account exists
   *   - audit_attempts is keyed on a requester, who may be anonymous
   *   - email_outbox is addressed to an email, not an account
   *   - deletion_log deliberately outlives the account it refers to
   *   - audit_events allows a null account for system-level events
   *   - staff are our people, not customers; merging the two is how a
   *     customer ends up one boolean away from reading someone's evidence
   *   - staff_sign_in_tokens and staff_sessions belong to a staff row, which
   *     has no account. Giving them an account_id would be claiming a staff
   *     identity belongs to one customer, which is the opposite of what the
   *     review role is for
   */
  const exempt = new Set([
    'accounts',
    'schema_migrations',
    'sign_in_tokens',
    'sessions',
    'audit_attempts',
    'email_outbox',
    'deletion_log',
    'audit_events',
    'staff',
    'staff_sign_in_tokens',
    'staff_sessions',
    'sqlite_sequence',
  ]);

  for (const table of tables) {
    if (exempt.has(table)) continue;

    const cols = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => (r as { name: string }).name);

    assert.ok(
      cols.includes('account_id'),
      `${table} holds customer data but has no account_id, so it cannot be scoped`
    );
  }
});

test('the schema file is the only place DDL lives', () => {
  // A CREATE TABLE outside the migration list is a table that exists on one
  // developer's machine and nowhere else.
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of ['repository.ts', 'auth.ts', 'jobs.ts', 'attempts.ts', 'events.ts']) {
    const src = readFileSync(join(here, file), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(src), `${file} creates a table outside the migrations`);
  }
});
