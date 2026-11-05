import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './db.ts';
import { SqliteAttemptStore, requesterIdFor } from './attempts.ts';
import { gate, SELF_AUDIT_ATTESTATION, DEFAULT_POLICY, type AuditPurpose } from '@rep/domain';

const purpose = (over: Partial<AuditPurpose> = {}): AuditPurpose => ({
  kind: 'self_audit',
  attestationText: SELF_AUDIT_ATTESTATION,
  attestedAt: '2026-10-29T00:00:00.000Z',
  verification: 'none',
  ...over,
});

const attempt = (subjectName: string, at: string, p: AuditPurpose = purpose()) => ({
  requesterId: 'req-1',
  subjectName,
  purpose: p,
  at,
});

const withFile = async (fn: (file: string) => Promise<void> | void) => {
  const dir = mkdtempSync(join(tmpdir(), 'rep-attempts-'));
  try {
    await fn(join(dir, 'test.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('attempts are recorded and read back within the window', async () => {
  const db = open({ location: ':memory:' });
  const store = new SqliteAttemptStore(db);

  await store.record(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z'));
  const recent = await store.recent('req-1', '2026-10-29T00:00:00.000Z');

  assert.equal(recent.length, 1);
  assert.equal(recent[0].subjectName, 'Jensen Adoni');
  assert.equal(recent[0].purpose.kind, 'self_audit');
});

test('attempts outside the window are not returned', async () => {
  const db = open({ location: ':memory:' });
  const store = new SqliteAttemptStore(db);

  await store.record(attempt('Jensen Adoni', '2026-10-01T10:00:00.000Z'));
  const recent = await store.recent('req-1', '2026-10-29T00:00:00.000Z');

  assert.equal(recent.length, 0);
});

test('one requester cannot see another requester’s attempts', async () => {
  const db = open({ location: ':memory:' });
  const store = new SqliteAttemptStore(db);

  await store.record(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z'));
  const other = await store.recent('req-2', '2026-10-29T00:00:00.000Z');

  assert.equal(other.length, 0);
});

test('the rate limit survives a restart', async () => {
  await withFile(async (file) => {
    const db1 = open({ location: file });
    const store1 = new SqliteAttemptStore(db1);

    for (let i = 0; i < DEFAULT_POLICY.maxPerWindow; i++) {
      const d = await gate(attempt('Jensen Adoni', `2026-10-29T1${i}:00:00.000Z`), store1);
      assert.equal(d.allowed, true, `attempt ${i + 1} should be allowed`);
    }
    db1.close();

    // This is the whole reason the package exists. With the in-memory store,
    // a restart cleared the counter and the limit meant nothing.
    const db2 = open({ location: file });
    const store2 = new SqliteAttemptStore(db2);

    const after = await gate(attempt('Jensen Adoni', '2026-10-29T16:00:00.000Z'), store2);
    assert.equal(after.allowed, false, 'a restart must not reset the limit');
    if (after.allowed) return;
    assert.equal(after.reason, 'rate_limited');
    db2.close();
  });
});

test('enumeration detection survives a restart', async () => {
  await withFile(async (file) => {
    const verified = purpose({ verification: 'verified_email' });

    const db1 = open({ location: file });
    const store1 = new SqliteAttemptStore(db1);
    await gate(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z', verified), store1);
    await gate(attempt('Alex Rivera', '2026-10-29T11:00:00.000Z', verified), store1);
    db1.close();

    const db2 = open({ location: file });
    const store2 = new SqliteAttemptStore(db2);
    const third = await gate(attempt('Dana Okoro', '2026-10-29T12:00:00.000Z', verified), store2);

    assert.equal(third.allowed, false);
    if (third.allowed) return;
    assert.equal(third.reason, 'enumeration_suspected');
    db2.close();
  });
});

test('a blocked attempt is not recorded, so a refusal costs nothing', async () => {
  const db = open({ location: ':memory:' });
  const store = new SqliteAttemptStore(db);

  const blocked = await gate(
    attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z', purpose({ attestationText: '' })),
    store
  );
  assert.equal(blocked.allowed, false);

  const recent = await store.recent('req-1', '2026-10-29T00:00:00.000Z');
  assert.equal(recent.length, 0, 'a refused request must not consume the allowance');
});

test('name variants count as one subject', async () => {
  const db = open({ location: ':memory:' });
  const store = new SqliteAttemptStore(db);

  await gate(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z'), store);
  const again = await gate(attempt('jensen  adoni', '2026-10-29T11:00:00.000Z'), store);

  assert.equal(again.allowed, true, 'typing your own name differently is not enumeration');
});

/**
 * The attempt store deliberately has no `prune` of its own.
 *
 * It used to, with a test very like the one that was here, and nothing in
 * the application called it — so the table holding a person's typed name was
 * the one table in the system with no clock on it (OQ-28). A passing test on
 * an unreachable method is worse than no method: it reads as a retention
 * policy from the outside.
 *
 * The sweep now lives in `enforceRetention`, and `retention.test.ts` holds
 * the test for it. This asserts the method has not come back, because the
 * obvious way to reintroduce the bug is to add it again for convenience.
 */
test('the store exposes no pruning of its own', () => {
  const db = open({ location: ':memory:' });
  const store = new SqliteAttemptStore(db) as unknown as Record<string, unknown>;

  assert.equal(
    typeof store.prune,
    'undefined',
    'attempts have a second retention path; the one in enforceRetention is no longer the whole story'
  );
});

test('the requester id is derived in one place', () => {
  // The audit route writes rows under this, and deleteAccount removes them
  // by it. They are the same function or deletion silently misses.
  assert.equal(requesterIdFor('acct_123'), 'account:acct_123');
});
