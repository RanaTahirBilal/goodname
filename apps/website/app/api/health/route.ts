/**
 * GET /api/health — is this process actually able to serve?
 *
 * Every host wants one of these, and the useless version answers 200 as
 * long as the web server is up, which is the one thing you already know
 * because the request arrived. This checks the two things that can be
 * broken while the process looks fine: the database, and the worker.
 *
 * ## What it deliberately does not say
 *
 * No counts of accounts, scans or evidence. This endpoint is reachable
 * without a session, and "how many people use this" is not something to
 * hand to anybody who can reach the port. The schema version and whether
 * a live provider is configured are facts about the deployment rather than
 * about any customer.
 */
import { NextResponse } from 'next/server';
import { MIGRATIONS } from '@rep/persistence';
import { store } from '../../../src/server/db.ts';
import { activeProvider } from '../../../src/server/search.ts';
import { workerState } from '../../../src/server/worker.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;

  /**
   * A query rather than a connection.
   *
   * `open()` succeeds against a file it cannot read from, so the useful
   * question is whether a statement runs and the migrations are in.
   */
  try {
    const { db } = store();
    const row = db
      .prepare('SELECT MAX(version) AS v FROM schema_migrations')
      .get() as { v: number | null };

    const expected = MIGRATIONS[MIGRATIONS.length - 1]!.version;

    if (row.v === expected) {
      checks.database = `ok, schema ${row.v}`;
    } else {
      ok = false;
      checks.database = `schema is ${row.v ?? 'absent'}, expected ${expected}`;
    }
  } catch (cause) {
    ok = false;
    checks.database = `unreachable: ${cause instanceof Error ? cause.message : String(cause)}`;
  }

  /**
   * The worker is the part that fails silently.
   *
   * If it is not running, audits queue for ever and nothing ages out or
   * gets purged. The process still answers every page, so a health check
   * that ignores it reports a healthy server that cannot finish any work.
   */
  const worker = workerState();
  if (worker.started) {
    checks.worker = worker.lastSweepAt
      ? `started, last swept ${worker.lastSweepAt}`
      : 'started';
  } else {
    ok = false;
    checks.worker = 'not started: queued audits will never finish and nothing ages out';
  }

  const provider = activeProvider();
  checks.search = provider.isFixture
    ? 'fixture data, no live provider configured'
    : `live, ${provider.name}`;

  checks.mail = 'no provider: sign-in codes are shown on screen';

  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
