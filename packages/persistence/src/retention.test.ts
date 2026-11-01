import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import {
  ScanRepository,
  ACCOUNT_OWNED_TABLES,
  type AccountScope,
} from './repository.ts';
import { ReviewRepository } from './review.ts';
import { StaffAuthRepository } from './staffAuth.ts';
import { AuthRepository } from './auth.ts';
import { JobQueue } from './jobs.ts';
import { rebuildReport } from './report.ts';
import {
  enforceRetention,
  retentionPreview,
  DEFAULT_RETENTION,
  type RetentionPolicy,
} from './retention.ts';
import {
  runAudit,
  FixtureSearchProvider,
  SELF_AUDIT_ATTESTATION,
  type AuditPurpose,
  type ProfessionalIdentity,
} from '@rep/domain';

const PURPOSE: AuditPurpose = {
  kind: 'self_audit',
  attestationText: SELF_AUDIT_ATTESTATION,
  attestedAt: '2026-10-30T00:00:00.000Z',
  verification: 'verified_email',
};

const ADONI: ProfessionalIdentity = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  region: 'Illinois',
  credentials: ['JD'],
};

const days = (iso: string, n: number): string =>
  new Date(Date.parse(iso) + n * 86_400_000).toISOString();

const NOW = '2026-11-01T00:00:00.000Z';

async function setup(scenario = 'official_finding') {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const review = new ReviewRepository(db);
  const auth = new AuthRepository(db);
  const staffAuth = new StaffAuthRepository(db);
  const queue = new JobQueue(db);

  const account = repo.createAccount('jensen@example.test');
  const scope: AccountScope = { accountId: account.id, actor: 'customer' };

  const report = await runAudit({
    identity: ADONI,
    purpose: PURPOSE,
    provider: new FixtureSearchProvider(scenario as never),
  });
  if (report.status !== 'complete') throw new Error('expected a report');

  const scanId = repo.saveScan(scope, {
    identity: ADONI,
    status: 'complete',
    provider: 'fixture',
    isFixture: true,
    window: 10,
    queries: report.scan.queries,
    purpose: PURPOSE,
    requesterId: 'test',
    evidence: report.evidence,
  });

  return { db, repo, review, auth, staffAuth, queue, scope, scanId, report };
}

/** Pushes every evidence row back so the whole scan is past its period. */
function ageEvidence(db: ReturnType<typeof open>, iso: string): void {
  db.prepare('UPDATE evidence SET retrieved_at = ?').run(iso);
}

/* ------------------------------------------------- the deletion contract */

test('every table with an account_id is in the deletion order', () => {
  const db = open({ location: ':memory:' });

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => (r as { name: string }).name);

  /**
   * This is the test that would have caught both of the bugs above.
   *
   * `jobs` and `review_decisions` each hold an account_id and a foreign key
   * to accounts, and neither was in the deletion order. The effect was not a
   * leftover row: the foreign key refused, the transaction rolled back, and
   * a customer asking to be deleted got an error with nothing removed.
   */
  const exempt = new Set([
    'accounts', // the parent row itself
    'review_access_log', // anonymised, not deleted: see deleteAccount
    'deletion_log', // deliberately outlives the account
    'schema_migrations',
    'sqlite_sequence',
  ]);

  const owned = ACCOUNT_OWNED_TABLES as readonly string[];

  for (const table of tables) {
    if (exempt.has(table)) continue;

    const cols = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => (r as { name: string }).name);

    if (!cols.includes('account_id')) continue;

    assert.ok(
      owned.includes(table),
      `${table} has an account_id but is not in ACCOUNT_OWNED_TABLES, ` +
        `so deleting an account with rows in it fails outright`
    );
  }
});

test('an account with a job and a review decision can still be deleted', async () => {
  const { db, repo, review, queue, scope, scanId } = await setup();

  queue.enqueue(scope, {
    type: 'audit',
    payload: { identity: ADONI },
    subjectType: 'scan',
    subjectId: scanId,
  });

  const staff = review.createStaff('ops@example.test', 'reviewer');
  const rScope = review.scopeFor(staff.id)!;
  const item = review.queue(rScope)[0];
  review.decide(rScope, scanId, item.evidenceId, 'uphold', 'Checked against the source.');

  const counts = repo.deleteAccount(scope);

  assert.equal(counts.jobs, 1);
  assert.equal(counts.review_decisions, 1);

  for (const table of ACCOUNT_OWNED_TABLES) {
    const left = db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`)
      .get(scope.accountId) as { n: number };
    assert.equal(Number(left.n), 0, `${table} still holds rows for a deleted account`);
  }
});

test('deletion anonymises the access log rather than destroying it', async () => {
  const { db, repo, review, scope, scanId } = await setup();

  const staff = review.createStaff('ops@example.test', 'reviewer');
  const rScope = review.scopeFor(staff.id)!;
  const item = review.queue(rScope)[0];
  review.decide(rScope, scanId, item.evidenceId, 'uphold', 'Checked against the source.');

  repo.deleteAccount(scope);

  const log = db
    .prepare('SELECT account_id, reviewer_id, action FROM review_access_log')
    .all() as Array<{ account_id: string; reviewer_id: string }>;

  // Who read how much, and when, survives. Whose it was does not.
  assert.ok(log.length > 0, 'the record of who read the evidence was destroyed');
  for (const entry of log) {
    assert.notEqual(entry.account_id, scope.accountId);
    assert.equal(entry.reviewer_id, staff.id);
  }
});

test('the export includes a reviewer judgement but not which reviewer made it', async () => {
  const { repo, review, scope, scanId } = await setup();

  const staff = review.createStaff('ops@example.test', 'reviewer');
  const rScope = review.scopeFor(staff.id)!;
  const item = review.queue(rScope)[0];
  review.decide(rScope, scanId, item.evidenceId, 'uphold', 'An official record, correct person.');

  const dump = JSON.stringify(repo.exportAccount(scope));

  // A judgement made about them is theirs. Which employee made it is not.
  assert.ok(dump.includes('An official record, correct person.'));
  assert.ok(!dump.includes(staff.id), 'the export names the individual reviewer');
});

/* ---------------------------------------------------- evidence expiry */

test('evidence past its period is deleted and the scan says so', async () => {
  const { db, repo, scope, scanId } = await setup();

  ageEvidence(db, days(NOW, -200));
  const result = enforceRetention(db, DEFAULT_RETENTION, NOW);

  assert.equal(result.scansExpired, 1);
  assert.ok(result.evidenceDeleted > 0);

  const scan = repo.getScan(scope, scanId)!;
  assert.equal(scan.evidence.length, 0);
  assert.equal(scan.evidenceExpiredAt, NOW);

  // The scan still completed. Saying otherwise would rewrite what happened
  // to describe our own housekeeping.
  assert.equal(scan.status, 'complete');
});

test('evidence inside its period is left alone', async () => {
  const { db, repo, scope, scanId } = await setup();

  ageEvidence(db, days(NOW, -179));
  const result = enforceRetention(db, DEFAULT_RETENTION, NOW);

  assert.equal(result.scansExpired, 0);
  assert.equal(repo.getScan(scope, scanId)!.evidence.length > 0, true);
});

test('a scan expires as a unit, never partially', async () => {
  const { db, repo, scope, scanId } = await setup();

  // One row still inside the window, the rest well past it. A row-by-row
  // policy would leave a report built from whatever happened to be newest
  // and present it as a complete one.
  db.prepare('UPDATE evidence SET retrieved_at = ?').run(days(NOW, -300));
  const one = db.prepare('SELECT id FROM evidence LIMIT 1').get() as { id: string };
  db.prepare('UPDATE evidence SET retrieved_at = ? WHERE id = ?').run(days(NOW, -10), one.id);

  const result = enforceRetention(db, DEFAULT_RETENTION, NOW);

  assert.equal(result.scansExpired, 0, 'a scan expired while part of it was still current');
  assert.ok(repo.getScan(scope, scanId)!.evidence.length > 1);
});

test('the score history survives the evidence', async () => {
  const { db, repo, scope, scanId, report } = await setup();

  repo.savePresence(scope, scanId, report.presence, 'initial scan');
  repo.saveRisk(scope, scanId, report.risk, 'initial scan');

  ageEvidence(db, days(NOW, -200));
  enforceRetention(db, DEFAULT_RETENTION, NOW);

  // The excerpt is the personal data. A number, a coverage fraction and a
  // methodology version are not, once the evidence behind them is gone.
  const history = repo.presenceHistory(scope, scanId);
  assert.equal(history.length, 1);
  assert.equal(history[0].methodologyVersion.length > 0, true);
});

test('a customer decision goes with the evidence it was about', async () => {
  const { db, repo, scope, scanId, report } = await setup();

  repo.recordDecision(scope, scanId, report.evidence[0].id, 'rejected');
  assert.equal(repo.getScan(scope, scanId)!.decisions.length, 1);

  ageEvidence(db, days(NOW, -200));
  enforceRetention(db, DEFAULT_RETENTION, NOW);

  // It named a quotation we have deleted, and says nothing anyone can act on.
  assert.equal(repo.getScan(scope, scanId)!.decisions.length, 0);
});

test('an expired scan is not rebuilt as a report that found nothing', async () => {
  const { db, repo, scope, scanId } = await setup();

  ageEvidence(db, days(NOW, -200));
  enforceRetention(db, DEFAULT_RETENTION, NOW);

  const scan = repo.getScan(scope, scanId)!;

  /**
   * This is the trap the flag exists for. Rebuilding an expired scan
   * produces a perfectly well-formed report that says we found almost
   * nothing about this person — indistinguishable from a real result. Any
   * caller must branch on `evidenceExpiredAt` before rendering.
   */
  assert.ok(scan.evidenceExpiredAt, 'nothing marks this scan as expired');

  const rebuilt = rebuildReport(scan, { reviews: [] });
  assert.equal(rebuilt.evidence.length, 0);
  assert.notEqual(
    rebuilt.presence.status,
    'scored',
    'an expired scan produced a scored report'
  );
});

test('a scan is only expired once', async () => {
  const { db } = await setup();

  ageEvidence(db, days(NOW, -200));
  assert.equal(enforceRetention(db, DEFAULT_RETENTION, NOW).scansExpired, 1);
  assert.equal(enforceRetention(db, DEFAULT_RETENTION, NOW).scansExpired, 0);
});

/* ------------------------------------------------ accountability outlives */

test('the access log outlives the evidence it refers to', async () => {
  const { db, review, scanId } = await setup();

  const staff = review.createStaff('ops@example.test', 'reviewer');
  const rScope = review.scopeFor(staff.id)!;
  const item = review.queue(rScope)[0];
  review.decide(rScope, scanId, item.evidenceId, 'uphold', 'Checked against the source.');

  ageEvidence(db, days(NOW, -200));
  enforceRetention(db, DEFAULT_RETENTION, NOW);

  const log = review.accessLog(staff.id);
  assert.ok(log.length > 0, 'the record of who read the evidence went with the evidence');
  assert.equal(review.decisionsFor(scanId).length, 1);
});

test('the access log is kept longer than the evidence', () => {
  assert.ok(
    DEFAULT_RETENTION.accessLogDays > DEFAULT_RETENTION.evidenceDays,
    'the record of who read the evidence must outlive the evidence'
  );
  assert.ok(DEFAULT_RETENTION.reviewDecisionDays > DEFAULT_RETENTION.evidenceDays);
});

test('a review decision past its own period does go', async () => {
  const { db, review, scanId } = await setup();

  const staff = review.createStaff('ops@example.test', 'reviewer');
  const rScope = review.scopeFor(staff.id)!;
  const item = review.queue(rScope)[0];
  review.decide(rScope, scanId, item.evidenceId, 'uphold', 'Checked against the source.');

  const later = days(NOW, 800);
  const result = enforceRetention(db, DEFAULT_RETENTION, later);

  assert.equal(result.reviewDecisionsDeleted, 1);
  assert.ok(result.accessLogDeleted > 0);
});

/* ------------------------------------------------------- operational rows */

test('a finished job and its payload are cleared', async () => {
  const { db, queue, scope } = await setup();

  const jobId = queue.enqueue(scope, { type: 'audit', payload: { identity: ADONI } });
  queue.claim();
  queue.succeed(jobId);

  // The payload holds the name, employer and city we searched for.
  const before = db.prepare('SELECT payload FROM jobs WHERE id = ?').get(jobId) as {
    payload: string;
  };
  assert.ok(before.payload.includes('Jensen Adoni'));

  const result = enforceRetention(db, DEFAULT_RETENTION, days(NOW, 60));
  assert.equal(result.jobsDeleted, 1);
});

test('an unfinished job is never cleared, however old', async () => {
  const { db, queue, scope } = await setup();
  queue.enqueue(scope, { type: 'audit', payload: {} });

  const result = enforceRetention(db, DEFAULT_RETENTION, days(NOW, 3650));

  assert.equal(result.jobsDeleted, 0);
  const left = db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
  assert.equal(Number(left.n), 1);
});

test('dead sessions are cleared and live ones are not', async () => {
  const { db, auth, staffAuth, review, scope } = await setup();

  const live = auth.createSession(scope.accountId);
  const dead = auth.createSession(scope.accountId);
  auth.revokeSession(dead);

  const staff = review.createStaff('ops@example.test', 'reviewer');
  const staffDead = staffAuth.createSession(staff.id);
  staffAuth.revokeSession(staffDead);

  const result = enforceRetention(db, DEFAULT_RETENTION, days(NOW, 60));

  assert.equal(result.sessionsDeleted, 1);
  assert.equal(result.staffSessionsDeleted, 1);
  assert.ok(auth.scopeForSession(live), 'a live session was cleared');
});

test('consumed sign-in codes are cleared on every pass', async () => {
  const { db, auth } = await setup();

  // A different address: the account made in setup is an anonymous one, and
  // verifying a code for its address would try to create a second account.
  const requested = auth.requestCode('someone-else@example.test');
  assert.ok('code' in requested);
  auth.verifyCode('someone-else@example.test', requested.code);

  assert.equal(enforceRetention(db, DEFAULT_RETENTION, NOW).signInTokensDeleted, 1);
});

/* ---------------------------------------------------------- the preview */

test('the preview says what a pass would delete, and deletes nothing', async () => {
  const { db, repo, scope, scanId } = await setup();

  ageEvidence(db, days(NOW, -200));
  const preview = retentionPreview(db, DEFAULT_RETENTION, NOW);

  assert.equal(preview.scansExpiring, 1);
  assert.ok(preview.evidenceExpiring > 0);
  assert.equal(repo.getScan(scope, scanId)!.evidence.length, preview.evidenceExpiring);
});

test('a policy with shorter periods expires more', async () => {
  const { db } = await setup();

  ageEvidence(db, days(NOW, -30));
  assert.equal(retentionPreview(db, DEFAULT_RETENTION, NOW).scansExpiring, 0);

  const strict: RetentionPolicy = { ...DEFAULT_RETENTION, evidenceDays: 7 };
  assert.equal(retentionPreview(db, strict, NOW).scansExpiring, 1);
});
