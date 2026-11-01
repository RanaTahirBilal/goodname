import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import { ReviewRepository } from './review.ts';
import {
  StaffAuthRepository,
  STAFF_MAX_CODE_ATTEMPTS,
  STAFF_MAX_CODES_PER_WINDOW,
  STAFF_SESSION_TTL_SECONDS,
} from './staffAuth.ts';
import { SESSION_TTL_SECONDS } from './auth.ts';

function setup() {
  const db = open({ location: ':memory:' });
  const review = new ReviewRepository(db);
  const auth = new StaffAuthRepository(db);
  const staff = review.createStaff('ops@example.test', 'reviewer');
  return { db, review, auth, staff };
}

/** Signs in and returns the session token. */
function signIn(auth: StaffAuthRepository, email: string): string {
  const issued = auth.requestCode(email);
  assert.ok(issued.issued, 'expected a code');
  const result = auth.verifyCode(email, issued.code);
  assert.ok(result.ok, 'expected the code to verify');
  return result.sessionToken;
}

/* ----------------------------------------------- no self-service path in */

test('a code is only issued to an existing, active member of staff', () => {
  const { auth } = setup();

  assert.equal(auth.requestCode('ops@example.test').issued, true);
  assert.equal(auth.requestCode('nobody@example.test').issued, false);
});

test('verifying a code never creates a member of staff', () => {
  const { db, auth } = setup();

  const before = db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number };

  // Every six-digit code, against an address that is not staff.
  for (const code of ['000000', '123456', '999999']) {
    assert.equal(auth.verifyCode('outsider@example.test', code).ok, false);
  }

  const after = db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number };

  // This is the rule the whole file exists for. Customer sign-in creates an
  // account on verification; if staff sign-in did the same, anyone who can
  // receive mail could grant themselves access across every account.
  assert.equal(Number(after.n), Number(before.n));
});

test('a code requested before someone was disabled stops working', () => {
  const { review, auth, staff } = setup();
  const issued = auth.requestCode('ops@example.test');
  assert.ok(issued.issued);

  review.disableStaff(staff.id);

  assert.equal(auth.verifyCode('ops@example.test', issued.code).ok, false);
});

/* ------------------------------------------------------ nothing storable */

test('the code and the session token are nowhere in the database', () => {
  const { db, auth } = setup();
  const issued = auth.requestCode('ops@example.test');
  assert.ok(issued.issued);

  const result = auth.verifyCode('ops@example.test', issued.code);
  assert.ok(result.ok);

  const dump = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => (r as { name: string }).name)
    .map((table) => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()))
    .join('\n');

  assert.ok(!dump.includes(issued.code), 'the raw code is in the database');
  assert.ok(!dump.includes(result.sessionToken), 'the raw session token is in the database');
});

/* ------------------------------------------------------------- guessing */

test('a wrong code burns attempts and the code dies after the limit', () => {
  const { auth } = setup();
  const issued = auth.requestCode('ops@example.test');
  assert.ok(issued.issued);

  const wrong = issued.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < STAFF_MAX_CODE_ATTEMPTS; i++) {
    assert.equal(auth.verifyCode('ops@example.test', wrong).ok, false);
  }

  // The right code no longer works either: guessing burns the code.
  assert.equal(auth.verifyCode('ops@example.test', issued.code).ok, false);
});

test('a code is single use', () => {
  const { auth } = setup();
  const issued = auth.requestCode('ops@example.test');
  assert.ok(issued.issued);

  assert.equal(auth.verifyCode('ops@example.test', issued.code).ok, true);
  assert.equal(auth.verifyCode('ops@example.test', issued.code).ok, false);
});

test('codes are throttled per staff member', () => {
  const { auth } = setup();

  for (let i = 0; i < STAFF_MAX_CODES_PER_WINDOW; i++) {
    assert.equal(auth.requestCode('ops@example.test').issued, true);
  }

  // Withheld, and indistinguishable from "not staff" — which is the point.
  assert.equal(auth.requestCode('ops@example.test').issued, false);
});

/* ------------------------------------------------------------- sessions */

test('a session resolves to a reviewer scope', () => {
  const { auth, staff } = setup();
  const token = signIn(auth, 'ops@example.test');

  const scope = auth.scopeForSession(token);
  assert.equal(scope?.reviewerId, staff.id);
  assert.equal(scope?.role, 'reviewer');
});

test('a made-up token resolves to nothing', () => {
  const { auth } = setup();
  assert.equal(auth.scopeForSession('not-a-token'), null);
});

test('revoking a session ends it', () => {
  const { auth } = setup();
  const token = signIn(auth, 'ops@example.test');

  assert.ok(auth.scopeForSession(token));
  assert.equal(auth.revokeSession(token), true);
  assert.equal(auth.scopeForSession(token), null);
});

test('disabling a reviewer ends the sessions they already hold', () => {
  const { review, auth, staff } = setup();
  const token = signIn(auth, 'ops@example.test');
  assert.ok(auth.scopeForSession(token));

  review.disableStaff(staff.id);

  // A session outliving the decision to remove access is the same bug as not
  // removing it. Both halves are checked: the row is revoked, and the lookup
  // requires an active staff row anyway.
  assert.equal(auth.scopeForSession(token), null);

  const row = review['db']
    .prepare('SELECT revoked_at FROM staff_sessions WHERE staff_id = ?')
    .get(staff.id) as { revoked_at: string | null };
  assert.ok(row.revoked_at, 'the session row was not revoked');
});

test('a staff session is much shorter-lived than a customer session', () => {
  // A customer session left open exposes that customer's own report. A staff
  // session left open exposes the queue, which is other people's evidence.
  assert.ok(
    STAFF_SESSION_TTL_SECONDS < SESSION_TTL_SECONDS,
    'staff sessions must not last as long as customer sessions'
  );
});

test('an expired session resolves to nothing', () => {
  const { db, auth } = setup();
  const token = signIn(auth, 'ops@example.test');

  db.prepare('UPDATE staff_sessions SET expires_at = ?').run('2020-01-01T00:00:00.000Z');

  assert.equal(auth.scopeForSession(token), null);
});

test('a reviewer can see their own live sessions and which one they are using', () => {
  const { auth, staff } = setup();
  const first = signIn(auth, 'ops@example.test');
  const second = signIn(auth, 'ops@example.test');

  const sessions = auth.sessions(staff.id, second);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter((s) => s.current).length, 1);
  assert.ok(sessions.some((s) => s.current));

  auth.revokeSession(first);
  assert.equal(auth.sessions(staff.id, second).length, 1);
});

test('a customer session token is not a staff session token', () => {
  const { db, auth } = setup();

  // The two tables are separate, so there is no shape of token that is valid
  // in both. A customer who somehow obtained a session token still has no
  // route into the queue.
  const token = signIn(auth, 'ops@example.test');
  const customerRows = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };

  assert.equal(Number(customerRows.n), 0, 'staff sign-in wrote a customer session');
  assert.ok(auth.scopeForSession(token));
});

/* --------------------------------------------------------------- pruning */

test('consumed and expired codes are prunable', () => {
  const { auth } = setup();
  const issued = auth.requestCode('ops@example.test');
  assert.ok(issued.issued);
  auth.verifyCode('ops@example.test', issued.code);

  assert.equal(auth.pruneTokens(), 1);
});
