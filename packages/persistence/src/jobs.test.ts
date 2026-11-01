import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import { JobQueue, backoffSeconds } from './jobs.ts';
import { ScanRepository, type AccountScope } from './repository.ts';
import { listEvents } from './events.ts';

function setup() {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const account = repo.createAccount('jensen@example.test');
  const scope: AccountScope = { accountId: account.id, actor: 'customer' };
  return { db, queue: new JobQueue(db), scope, repo };
}

const at = (iso: string) => iso;

/* --------------------------------------------------------- the basics */

test('a queued job can be claimed and completed', () => {
  const { queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'audit', payload: { scanId: 'scan-1' } });

  const claimed = queue.claim();
  assert.ok(claimed);
  assert.equal(claimed!.id, id);
  assert.equal(claimed!.status, 'running');
  assert.equal(claimed!.attempts, 1);
  assert.equal(claimed!.payload.scanId, 'scan-1');

  queue.succeed(id);
  assert.equal(queue.get(scope, id)!.status, 'succeeded');
});

test('an empty queue claims nothing', () => {
  const { queue } = setup();
  assert.equal(queue.claim(), null);
});

test('a claimed job is not handed out twice', () => {
  const { queue, scope } = setup();
  queue.enqueue(scope, { type: 'audit' });

  // The whole point of claiming in a transaction: two workers must not both
  // send the same scan to a provider and bill the customer twice.
  assert.ok(queue.claim());
  assert.equal(queue.claim(), null);
});

test('jobs are claimed oldest first', () => {
  const { queue, scope } = setup();
  const first = queue.enqueue(scope, { type: 'audit', payload: { n: 1 } });
  queue.enqueue(scope, { type: 'audit', payload: { n: 2 } });

  assert.equal(queue.claim()!.id, first);
});

test('a delayed job is not claimable until it is due', () => {
  const { queue, scope } = setup();
  queue.enqueue(scope, { type: 'audit', delaySeconds: 3600 });

  assert.equal(queue.claim(), null);

  const later = new Date(Date.now() + 7200_000).toISOString();
  assert.ok(queue.claim(at(later)));
});

/* ------------------------------------------------------------ retries */

test('a failed job returns to the queue with backoff', () => {
  const { queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'audit' });

  queue.claim();
  const { willRetry } = queue.fail(id, 'provider timed out');

  assert.equal(willRetry, true);
  const job = queue.get(scope, id)!;
  assert.equal(job.status, 'queued');
  assert.equal(job.lastError, 'provider timed out');
  assert.ok(Date.parse(job.availableAt) > Date.now(), 'backoff should push it into the future');
});

test('backoff grows and then stops growing', () => {
  assert.equal(backoffSeconds(1), 2);
  assert.equal(backoffSeconds(2), 8);
  assert.equal(backoffSeconds(3), 32);

  // Capped: a job failing this often needs a person, not another attempt.
  assert.equal(backoffSeconds(20), 300);
});

test('a job gives up after its attempts are exhausted', () => {
  const { queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'audit', maxAttempts: 2 });

  const future = () => new Date(Date.now() + 3600_000).toISOString();

  queue.claim();
  assert.equal(queue.fail(id, 'first').willRetry, true);

  queue.claim(future());
  assert.equal(queue.fail(id, 'second').willRetry, false);

  const job = queue.get(scope, id)!;
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 2);
  assert.ok(job.finishedAt);
});

test('a job that already sent something outward is never retried', () => {
  const { queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'correction_request', maxAttempts: 5 });

  queue.claim();
  queue.markSideEffectsSent(id);

  // Re-running a search costs money. Re-sending a correction request to a
  // publisher sends it twice, and that cannot be taken back.
  const { willRetry } = queue.fail(id, 'crashed after sending');

  assert.equal(willRetry, false, 'attempts remained, but the send already happened');
  assert.equal(queue.get(scope, id)!.status, 'failed');
});

/* ------------------------------------------------------ stalled jobs */

test('a job stuck running is returned to the queue', () => {
  const { queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'audit' });
  queue.claim();

  // Nothing reclaimed while it is still within the timeout.
  assert.equal(queue.reclaimStalled(600), 0);

  const later = new Date(Date.now() + 3600_000).toISOString();
  assert.equal(queue.reclaimStalled(600, later), 1);
  assert.equal(queue.get(scope, id)!.status, 'queued');
});

test('a stalled job that had sent something is failed, not retried', () => {
  const { queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'correction_request' });
  queue.claim();
  queue.markSideEffectsSent(id);

  const later = new Date(Date.now() + 3600_000).toISOString();
  assert.equal(queue.reclaimStalled(600, later), 0);

  const job = queue.get(scope, id)!;
  assert.equal(job.status, 'failed');
  assert.match(job.lastError!, /Worker stopped/);
});

/* -------------------------------------------------- account isolation */

test('one account cannot read another account’s job', () => {
  const { queue, scope, repo } = setup();
  const id = queue.enqueue(scope, { type: 'audit' });

  const other = repo.createAccount('someone-else@example.test');
  const otherScope: AccountScope = { accountId: other.id, actor: 'customer' };

  assert.equal(queue.get(otherScope, id), null);
});

test('a job can be found by the subject it works on', () => {
  const { queue, scope } = setup();
  const id = queue.enqueue(scope, {
    type: 'audit',
    subjectType: 'scan',
    subjectId: 'scan-42',
  });

  assert.equal(queue.forSubject(scope, 'scan', 'scan-42')!.id, id);
  assert.equal(queue.forSubject(scope, 'scan', 'scan-other'), null);
});

/* -------------------------------------------------------- bookkeeping */

test('enqueueing and failing are recorded in the audit log', () => {
  const { db, queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'audit', maxAttempts: 1 });
  queue.claim();
  queue.fail(id, 'provider unreachable');

  const actions = listEvents(db, scope.accountId).map((e) => e.action);
  assert.ok(actions.includes('job.enqueued'));
  assert.ok(actions.includes('job.failed'));
});

test('a transient failure is not logged as a failure', () => {
  const { db, queue, scope } = setup();
  const id = queue.enqueue(scope, { type: 'audit', maxAttempts: 3 });
  queue.claim();
  queue.fail(id, 'one bad minute');

  // A retryable blip is not an incident. Logging it as one trains people to
  // ignore the log.
  const failures = listEvents(db, scope.accountId).filter((e) => e.action === 'job.failed');
  assert.equal(failures.length, 0);
});

test('queue depth is reportable', () => {
  const { queue, scope } = setup();
  queue.enqueue(scope, { type: 'audit' });
  queue.enqueue(scope, { type: 'audit' });
  queue.claim();

  const counts = queue.counts();
  assert.equal(counts.queued, 1);
  assert.equal(counts.running, 1);
  assert.equal(counts.succeeded, 0);
});
