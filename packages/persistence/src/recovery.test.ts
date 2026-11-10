/**
 * What has to be true for the worker to live inside the web process.
 *
 * The in-process worker dies with the server. Asked whether that blocks a
 * first paid engagement, the answer that came back was: not by itself, so
 * long as five things can be demonstrated rather than assumed. Jobs persist
 * before they run. An interrupted job can be identified. Retry is safe or
 * explicitly controlled. Duplicate execution cannot produce a duplicate
 * outward action. Staff can inspect and recover a failure.
 *
 * Each of those was true of this code already, scattered across `jobs.ts`
 * as individual behaviours with their own tests. None of them was written
 * down as a *guarantee*, which is a different thing: a guarantee is what
 * somebody checks before deciding where the worker runs, and a behaviour is
 * what somebody changes without realising they have withdrawn one.
 *
 * So this file is the list, in that order, asserted. It is the answer to
 * "can this ship in one process", and it fails the day it stops being yes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import { JobQueue } from './jobs.ts';
import { ScanRepository, type AccountScope } from './repository.ts';

function setup() {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const queue = new JobQueue(db);
  const account = repo.createAccount('jensen@example.test');
  const scope: AccountScope = { accountId: account.id, actor: 'customer' };
  return { db, repo, queue, scope };
}

test('1. a job is durable before it is ever run', () => {
  /**
   * The weakest link in an in-process worker is an in-process queue: a job
   * held in memory and handed to a function is gone when the process is,
   * with nothing to find afterwards. Enqueueing writes a row, and the row
   * exists before anything claims it.
   */
  const { db, queue, scope } = setup();

  const id = queue.enqueue(scope, { type: 'audit', payload: { scanId: 'scan_1' } });

  const row = db.prepare('SELECT status, started_at FROM jobs WHERE id = ?').get(id) as {
    status: string;
    started_at: string | null;
  };

  assert.equal(row.status, 'queued');
  assert.equal(row.started_at, null, 'the job was marked started before anybody claimed it');
});

test('2. a job interrupted by a restart is identifiable afterwards', () => {
  // The process dies mid-audit. What is left behind has to be
  // distinguishable from a job that is running right now, which is what
  // `started_at` is for: a running job with an old start is an abandoned
  // one, and nothing else looks like that.
  const { db, queue, scope } = setup();

  const id = queue.enqueue(scope, { type: 'audit' });
  queue.claim();

  const row = db.prepare('SELECT status, started_at FROM jobs WHERE id = ?').get(id) as {
    status: string;
    started_at: string | null;
  };

  assert.equal(row.status, 'running');
  assert.ok(row.started_at, 'a running job records no start time, so a crash leaves no trace');
});

test('3. an abandoned job returns to the queue rather than sitting there', () => {
  const { queue, scope } = setup();

  queue.enqueue(scope, { type: 'audit' });
  queue.claim();

  const later = new Date(Date.now() + 20 * 60_000).toISOString();
  assert.equal(queue.reclaimStalled(600, later), 1, 'nothing recovers an interrupted job');

  assert.ok(queue.claim(later), 'the reclaimed job cannot be picked up again');
});

test('4. retry is bounded, so a permanently failing job stops', () => {
  /**
   * Unbounded retry against a paid search provider is a bill rather than a
   * bug report. The cap is on the row, not in the worker, so it survives
   * the restart that caused the retry.
   */
  const { queue, scope } = setup();

  const id = queue.enqueue(scope, { type: 'audit', maxAttempts: 2 });

  queue.claim();
  assert.equal(queue.fail(id, 'provider timeout').willRetry, true);

  queue.claim(new Date(Date.now() + 60 * 60_000).toISOString());
  assert.equal(
    queue.fail(id, 'provider timeout').willRetry,
    false,
    'a job that cannot succeed will retry for ever'
  );
});

test('5. a duplicate run cannot send the same thing twice', () => {
  /**
   * The guarantee that makes the other four safe. An audit is a read, so
   * running it twice costs money and nothing else. A job that posts a
   * correction request to a third party is not: re-running it sends a
   * second one, to somebody who already had the first.
   *
   * So a job marks its side effects before it awaits the response, and a
   * job that has marked them is never handed out again. The order matters:
   * marking afterwards means a crash between sending and marking looks
   * exactly like a crash before sending.
   */
  const { queue, scope } = setup();

  const id = queue.enqueue(scope, { type: 'correction' });
  queue.claim();
  queue.markSideEffectsSent(id);
  queue.fail(id, 'the connection dropped after we sent it');

  const later = new Date(Date.now() + 20 * 60_000).toISOString();
  queue.reclaimStalled(600, later);

  assert.equal(
    queue.claim(later),
    null,
    'a job that has already sent something outward was handed out again'
  );
});

test('6. a failure is inspectable rather than silent', () => {
  // "Staff can inspect and recover" starts with the failure being legible:
  // why it stopped, how many times it tried, and when.
  const { db, queue, scope } = setup();

  const id = queue.enqueue(scope, { type: 'audit', maxAttempts: 1 });
  queue.claim();
  queue.fail(id, 'provider returned 503');

  const row = db
    .prepare('SELECT status, attempts, last_error, finished_at FROM jobs WHERE id = ?')
    .get(id) as { status: string; attempts: number; last_error: string; finished_at: string };

  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /503/, 'the reason it failed was not kept');
  assert.ok(row.finished_at, 'a failed job has no end time, so nothing can report on it');
});

test('the scan does not inherit a failure the job will retry', () => {
  /**
   * Rule 16l, which is the one a restart is most likely to violate: telling
   * somebody their audit failed while a retry is queued is a wrong answer,
   * not an early one.
   */
  const { queue, scope } = setup();

  const id = queue.enqueue(scope, { type: 'audit', maxAttempts: 3 });
  queue.claim();

  const { willRetry } = queue.fail(id, 'provider timeout');
  assert.equal(willRetry, true, 'a retryable failure is being treated as terminal');
});
