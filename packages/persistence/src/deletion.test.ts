/**
 * Scheduled deletion: request, grace period, purge, cancel.
 *
 * Hard deletion already existed and was exercised by `repository.test.ts`.
 * It also had no caller — nothing in the API or the interface could reach
 * it, so a customer had an erasure right on paper and no way to use it.
 * These tests cover the lifecycle a customer actually triggers.
 *
 * The one that matters most is the last: that the purge, when it comes,
 * really is the hard deletion and not a flag on a row we keep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import {
  ScanRepository,
  purgeDueAccounts,
  DELETION_GRACE_DAYS,
  type AccountScope,
} from './repository.ts';

function setup() {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const account = repo.createAccount('jensen@example.test');
  const scope: AccountScope = { accountId: account.id, actor: 'customer' };
  return { db, repo, account, scope };
}

const daysFromNow = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString();

test('requesting deletion schedules it rather than doing it', () => {
  const { repo, scope } = setup();

  const status = repo.requestDeletion(scope, 'no_longer_needed');

  assert.ok(status.purgeAt > status.requestedAt);
  assert.equal(
    Math.round((Date.parse(status.purgeAt) - Date.parse(status.requestedAt)) / 86_400_000),
    DELETION_GRACE_DAYS
  );

  // And the account is still there, which is the whole point of a grace period.
  assert.ok(repo.findAccountByEmail('jensen@example.test'));
});

/**
 * Clicking again because you were not sure it worked must not punish you.
 *
 * Re-requesting used to be the obvious place to recompute `purge_at`, which
 * would quietly push somebody's own deletion a month further away every time
 * they checked on it.
 */
test('requesting twice does not extend the grace period', () => {
  const { repo, scope } = setup();

  const first = repo.requestDeletion(scope);
  const second = repo.requestDeletion(scope, 'a different reason');

  assert.deepEqual(second, first);
});

test('a pending deletion is visible, and cancellable', () => {
  const { repo, scope } = setup();

  assert.equal(repo.deletionStatus(scope), null);

  repo.requestDeletion(scope);
  assert.ok(repo.deletionStatus(scope));

  assert.equal(repo.cancelDeletion(scope), true);
  assert.equal(repo.deletionStatus(scope), null);

  // Cancelling when nothing is pending is a no-op, not an error.
  assert.equal(repo.cancelDeletion(scope), false);
});

test('nothing is purged before the grace period is up', () => {
  const { db, repo, scope } = setup();

  repo.requestDeletion(scope);

  const result = purgeDueAccounts(db, daysFromNow(DELETION_GRACE_DAYS - 1));

  assert.equal(result.purged, 0);
  assert.ok(repo.findAccountByEmail('jensen@example.test'));
});

test('the account is purged once the grace period passes', () => {
  const { db, repo, scope } = setup();

  repo.requestDeletion(scope);
  const result = purgeDueAccounts(db, daysFromNow(DELETION_GRACE_DAYS + 1));

  assert.equal(result.purged, 1);
  assert.equal(result.failed, 0);
  assert.equal(repo.findAccountByEmail('jensen@example.test'), null);
});

test('an account that never asked is never purged', () => {
  const { db, repo } = setup();

  const result = purgeDueAccounts(db, daysFromNow(3650));

  assert.equal(result.purged, 0);
  assert.ok(repo.findAccountByEmail('jensen@example.test'));
});

/**
 * The purge is the hard deletion, not a flag.
 *
 * A scheduled deletion that ends in `deleted_at = now` would leave every row
 * of evidence, every snapshot and every session exactly where it was, while
 * the interface said the account was gone. The point of routing this through
 * `deleteAccount` is that the existing tests for hard deletion are also the
 * tests for what the grace period ends in.
 */
test('the purge removes the rows, not just the account', () => {
  const { db, repo, scope, account } = setup();

  db.prepare(
    `INSERT INTO professional_identities
       (id, account_id, full_name, profession, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run('pid_1', account.id, 'Jensen Adoni', 'attorney', new Date().toISOString());

  repo.requestDeletion(scope);
  purgeDueAccounts(db, daysFromNow(DELETION_GRACE_DAYS + 1));

  const left = db
    .prepare('SELECT COUNT(*) AS n FROM professional_identities WHERE account_id = ?')
    .get(account.id) as { n: number };

  assert.equal(Number(left.n), 0, 'the identity survived a purge');

  const accounts = db
    .prepare('SELECT COUNT(*) AS n FROM accounts WHERE id = ?')
    .get(account.id) as { n: number };

  assert.equal(Number(accounts.n), 0, 'the account row survived a purge');
});

/**
 * The reason the request does not set `deleted_at`.
 *
 * The unique email index is partial on `deleted_at IS NULL`. Marking the
 * account deleted at request time would free the address immediately — and
 * then a cancellation inside the grace period would collide with whatever
 * had taken it. A pending deletion is a live account that has asked to
 * stop, not a dead one.
 */
test('a pending deletion does not free the email address', () => {
  const { repo, scope } = setup();

  repo.requestDeletion(scope);

  assert.throws(
    () => repo.createAccount('jensen@example.test'),
    /UNIQUE|constraint/i,
    'the address was released while the account could still be recovered'
  );

  // And cancelling puts everything back.
  assert.equal(repo.cancelDeletion(scope), true);
  assert.ok(repo.findAccountByEmail('jensen@example.test'));
});

test('requesting and cancelling are both recorded as events', () => {
  const { db, repo, scope, account } = setup();

  repo.requestDeletion(scope);
  repo.cancelDeletion(scope);

  const actions = db
    .prepare('SELECT action FROM audit_events WHERE account_id = ? ORDER BY occurred_at')
    .all(account.id)
    .map((r) => String((r as { action: string }).action));

  assert.ok(actions.includes('account.deletion_requested'));
  assert.ok(actions.includes('account.deletion_cancelled'));
});

/**
 * Several due accounts go in one sweep.
 *
 * Each is purged in its own transaction so that one bad account cannot
 * block the queue behind it — a single unanticipated foreign key would
 * otherwise mean every later deletion request silently stops happening.
 * That failure path is not exercised here: provoking it means corrupting
 * the schema, and `ACCOUNT_OWNED_TABLES` has a structural test of its own
 * that exists to stop it arising. What this does assert is the loop: more
 * than one account, all of them gone, none skipped.
 */
test('every due account is purged in a single sweep', () => {
  const { db, repo, scope } = setup();
  const second = new ScanRepository(db).createAccount('other@example.test');

  repo.requestDeletion(scope);
  repo.requestDeletion({ accountId: second.id, actor: 'customer' });

  const result = purgeDueAccounts(db, daysFromNow(DELETION_GRACE_DAYS + 1));

  assert.equal(result.purged, 2);
  assert.equal(result.failed, 0);
  assert.equal(repo.findAccountByEmail('jensen@example.test'), null);
  assert.equal(repo.findAccountByEmail('other@example.test'), null);
});
