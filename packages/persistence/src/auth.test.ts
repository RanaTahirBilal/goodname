import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import { AuthRepository, MAX_CODE_ATTEMPTS, MAX_CODES_PER_WINDOW } from './auth.ts';
import { OutboxDeliverer, readOutbox, signInEmail } from './email.ts';
import { ScanRepository, type AccountScope } from './repository.ts';
import { listEvents } from './events.ts';
import { gate, SELF_AUDIT_ATTESTATION, type AuditPurpose } from '@rep/domain';
import { SqliteAttemptStore } from './attempts.ts';

const setup = () => {
  const db = open({ location: ':memory:' });
  return { db, auth: new AuthRepository(db), repo: new ScanRepository(db) };
};

const codeFor = (auth: AuthRepository, email: string, claim?: string): string => {
  const req = auth.requestCode(email, claim);
  assert.ok(!('throttled' in req), 'expected a code, got throttled');
  return (req as { code: string }).code;
};

/* ------------------------------------------------------- storing secrets */

test('the code is never stored in a usable form', () => {
  const { db, auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');

  const rows = db.prepare('SELECT * FROM sign_in_tokens').all();
  const blob = JSON.stringify(rows);

  assert.ok(!blob.includes(code), 'the raw code is recoverable from the database');
  assert.equal(rows.length, 1);
});

test('the session token is never stored in a usable form', () => {
  const { db, auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');
  const result = auth.verifyCode('jensen@example.test', code);

  assert.ok(result.ok);
  if (!result.ok) return;

  const blob = JSON.stringify(db.prepare('SELECT * FROM sessions').all());
  assert.ok(!blob.includes(result.sessionToken), 'the session token is recoverable');
});

/* ------------------------------------------------------------ the flow */

test('a correct code signs in and creates a working session', () => {
  const { auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');

  const result = auth.verifyCode('jensen@example.test', code);
  assert.ok(result.ok);
  if (!result.ok) return;

  const scope = auth.scopeForSession(result.sessionToken);
  assert.ok(scope);
  assert.equal(scope!.accountId, result.accountId);
  assert.equal(scope!.verified, true);
  assert.equal(scope!.email, 'jensen@example.test');
});

test('email is normalised, so case and spacing do not create second accounts', () => {
  const { auth } = setup();

  const first = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  const second = auth.verifyCode('  JENSEN@Example.TEST ', codeFor(auth, 'Jensen@Example.test'));

  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.equal(first.accountId, second.accountId);
});

test('a code works exactly once', () => {
  const { auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');

  assert.ok(auth.verifyCode('jensen@example.test', code).ok);

  const again = auth.verifyCode('jensen@example.test', code);
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.reason, 'invalid_or_expired');
});

test('an expired code is refused', () => {
  const { db, auth } = setup();
  codeFor(auth, 'jensen@example.test');

  db.prepare('UPDATE sign_in_tokens SET expires_at = ?').run('2020-01-01T00:00:00.000Z');

  const result = auth.verifyCode('jensen@example.test', '000000');
  assert.equal(result.ok, false);
});

test('a wrong code never signs anyone in', () => {
  const { auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');
  const wrong = code === '000000' ? '111111' : '000000';

  const result = auth.verifyCode('jensen@example.test', wrong);
  assert.equal(result.ok, false);
});

test('guessing burns the code after a handful of attempts', () => {
  const { auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');
  const wrong = code === '000000' ? '111111' : '000000';

  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    assert.equal(auth.verifyCode('jensen@example.test', wrong).ok, false);
  }

  // Six digits is only safe because of this. The correct code must now fail.
  const result = auth.verifyCode('jensen@example.test', code);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'too_many_attempts');
});

test('a code for one address does not work for another', () => {
  const { auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');

  assert.equal(auth.verifyCode('someone-else@example.test', code).ok, false);
});

test('requesting codes is throttled per address', () => {
  const { auth } = setup();

  for (let i = 0; i < MAX_CODES_PER_WINDOW; i++) {
    assert.ok(!('throttled' in auth.requestCode('jensen@example.test')));
  }

  const next = auth.requestCode('jensen@example.test');
  assert.ok('throttled' in next);
});

test('requesting a code reveals nothing about whether the address is known', () => {
  const { auth } = setup();

  auth.verifyCode('known@example.test', codeFor(auth, 'known@example.test'));

  const known = auth.requestCode('known@example.test');
  const unknown = auth.requestCode('never-seen@example.test');

  // Both produce a code and an expiry, and neither says anything else.
  assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
});

/* ----------------------------------------------------------- sessions */

test('a revoked session stops working immediately', () => {
  const { auth } = setup();
  const result = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  assert.ok(result.ok);
  if (!result.ok) return;

  assert.ok(auth.scopeForSession(result.sessionToken));
  assert.equal(auth.revokeSession(result.sessionToken), true);
  assert.equal(auth.scopeForSession(result.sessionToken), null);
});

test('an expired session stops working', () => {
  const { db, auth } = setup();
  const result = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  assert.ok(result.ok);
  if (!result.ok) return;

  db.prepare('UPDATE sessions SET expires_at = ?').run('2020-01-01T00:00:00.000Z');
  assert.equal(auth.scopeForSession(result.sessionToken), null);
});

test('signing out everywhere ends every session', () => {
  const { auth } = setup();
  const first = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  assert.ok(first.ok);
  if (!first.ok) return;

  const second = auth.createSession(first.accountId);
  const scope: AccountScope = { accountId: first.accountId, actor: 'customer' };

  assert.equal(auth.revokeAllSessions(scope), 2);
  assert.equal(auth.scopeForSession(first.sessionToken), null);
  assert.equal(auth.scopeForSession(second), null);
});

test('a garbage token resolves to nothing', () => {
  const { auth } = setup();
  assert.equal(auth.scopeForSession('not-a-real-token'), null);
  assert.equal(auth.scopeForSession(''), null);
});

test('a session for a deleted account stops working', () => {
  const { auth, repo } = setup();
  const result = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  assert.ok(result.ok);
  if (!result.ok) return;

  repo.deleteAccount({ accountId: result.accountId, actor: 'customer' });
  assert.equal(auth.scopeForSession(result.sessionToken), null);
});

/* ------------------------------------------------------------ claiming */

test('an anonymous account is claimed on first sign-in, keeping its scans', () => {
  const { auth, repo } = setup();
  const anon = auth.createAnonymousAccount();
  const anonScope: AccountScope = { accountId: anon.accountId, actor: 'customer' };

  const scanId = repo.saveScan(anonScope, {
    identity: { fullName: 'Jensen Adoni', profession: 'attorney' },
    status: 'complete',
    provider: 'fixture',
    isFixture: true,
    window: 10,
    queries: ['Jensen Adoni'],
    purpose: {} as AuditPurpose,
    requesterId: 'test',
  });

  const result = auth.verifyCode(
    'jensen@example.test',
    codeFor(auth, 'jensen@example.test', anon.accountId)
  );

  assert.ok(result.ok);
  if (!result.ok) return;

  assert.equal(result.claimed, true);
  assert.equal(result.accountId, anon.accountId, 'the anonymous account became the real one');

  // The visitor's first audit survives signing up, which is the point.
  assert.ok(repo.getScan({ accountId: result.accountId, actor: 'customer' }, scanId));
});

test('signing in to an existing account reports what the anonymous one held', () => {
  const { auth, repo } = setup();

  const first = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  assert.ok(first.ok);
  if (!first.ok) return;

  const anon = auth.createAnonymousAccount();
  repo.saveScan(
    { accountId: anon.accountId, actor: 'customer' },
    {
      identity: { fullName: 'Jensen Adoni', profession: 'attorney' },
      status: 'complete',
      provider: 'fixture',
      isFixture: true,
      window: 10,
      queries: ['Jensen Adoni'],
      purpose: {} as AuditPurpose,
      requesterId: 'test',
    }
  );

  const second = auth.verifyCode(
    'jensen@example.test',
    codeFor(auth, 'jensen@example.test', anon.accountId)
  );

  assert.ok(second.ok);
  if (!second.ok) return;

  // Merging two accounts' scans has no undo, so we do not do it silently.
  // We sign into the real account and say what was left behind.
  assert.equal(second.accountId, first.accountId);
  assert.equal(second.claimed, false);
  assert.equal(second.orphanedScans, 1);
});

/* --------------------------------------------------- escalating checks */

test('verifying an email unblocks the second distinct name', async () => {
  const { db, auth } = setup();
  const attempts = new SqliteAttemptStore(db);

  const purpose = (verification: AuditPurpose['verification']): AuditPurpose => ({
    kind: 'self_audit',
    attestationText: SELF_AUDIT_ATTESTATION,
    attestedAt: '2026-10-29T00:00:00.000Z',
    verification,
  });

  const result = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  assert.ok(result.ok);
  if (!result.ok) return;

  const scope = auth.scopeForSession(result.sessionToken)!;
  const requesterId = `account:${scope.accountId}`;

  await gate(
    { requesterId, subjectName: 'Jensen Adoni', purpose: purpose('none'), at: '2026-10-29T10:00:00.000Z' },
    attempts
  );

  // Unverified, a second name is refused...
  const unverified = await gate(
    { requesterId, subjectName: 'Alex Rivera', purpose: purpose('none'), at: '2026-10-29T11:00:00.000Z' },
    attempts
  );
  assert.equal(unverified.allowed, false);
  if (!unverified.allowed) assert.equal(unverified.reason, 'verification_required');

  // ...and with the verified email this session actually has, it is allowed.
  assert.equal(scope.verified, true);
  const verified = await gate(
    {
      requesterId,
      subjectName: 'Alex Rivera',
      purpose: purpose('verified_email'),
      at: '2026-10-29T11:05:00.000Z',
    },
    attempts
  );
  assert.equal(verified.allowed, true);
});

test('an anonymous session is not verified', () => {
  const { auth } = setup();
  const anon = auth.createAnonymousAccount();
  const scope = auth.scopeForSession(anon.sessionToken);

  assert.ok(scope);
  assert.equal(scope!.verified, false, 'a browser cookie is not an identity');
});

/* --------------------------------------------------------------- email */

test('the outbox deliverer says plainly that nothing was sent', async () => {
  const { db, auth } = setup();
  const deliverer = new OutboxDeliverer(db, { log: false });
  const code = codeFor(auth, 'jensen@example.test');
  const message = signInEmail(code, 10);

  const result = await deliverer.send({ to: 'jensen@example.test', ...message });

  assert.equal(result.delivered, false, 'no provider is configured, so nothing was sent');
  assert.equal(deliverer.reallySends, false);

  const outbox = readOutbox(db, 'jensen@example.test');
  assert.equal(outbox.length, 1);
  assert.ok(outbox[0].body.includes(code));
});

/* ---------------------------------------------------------- audit trail */

test('signing in is recorded', () => {
  const { db, auth } = setup();
  const result = auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  assert.ok(result.ok);
  if (!result.ok) return;

  const actions = listEvents(db, result.accountId).map((e) => e.action);
  assert.ok(actions.includes('auth.signed_in'));
});

test('the audit log never contains the code or the session token', () => {
  const { db, auth } = setup();
  const code = codeFor(auth, 'jensen@example.test');
  const result = auth.verifyCode('jensen@example.test', code);
  assert.ok(result.ok);
  if (!result.ok) return;

  const blob = JSON.stringify(listEvents(db, result.accountId));
  assert.ok(!blob.includes(code));
  assert.ok(!blob.includes(result.sessionToken));
});

test('pruning clears consumed and expired codes', () => {
  const { db, auth } = setup();
  auth.verifyCode('jensen@example.test', codeFor(auth, 'jensen@example.test'));
  codeFor(auth, 'other@example.test');

  const removed = auth.pruneTokens();
  assert.equal(removed, 1, 'the consumed code should go, the live one should stay');

  const left = db.prepare('SELECT COUNT(*) AS n FROM sign_in_tokens').get();
  assert.equal(Number((left as { n: number }).n), 1);
});
