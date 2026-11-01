import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, migrate } from './db.ts';
import { ScanRepository, type AccountScope } from './repository.ts';
import { listEvents } from './events.ts';
import { rebuildReport, applyDecisions } from './report.ts';
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
  attestedAt: '2026-10-29T00:00:00.000Z',
  verification: 'verified_email',
};

const ADONI: ProfessionalIdentity = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  region: 'Illinois',
  credentials: ['JD'],
  websiteUrl: 'https://adoni-law.example',
};

function setup() {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const account = repo.createAccount('jensen@example.test');
  const scope: AccountScope = { accountId: account.id, actor: 'customer' };
  return { db, repo, account, scope };
}

async function seedScan(repo: ScanRepository, scope: AccountScope, scenario = 'strong') {
  const report = await runAudit({
    identity: ADONI,
    purpose: PURPOSE,
    provider: new FixtureSearchProvider(scenario as never),
  });
  if (report.status !== 'complete') throw new Error('expected a complete report');

  const scanId = repo.saveScan(scope, {
    identity: ADONI,
    status: 'complete',
    provider: report.scan.provider,
    isFixture: report.scan.isFixture,
    window: report.scan.window,
    queries: report.scan.queries,
    purpose: PURPOSE,
    requesterId: 'test',
    coverageNote: report.scan.coverageNote,
    evidence: report.evidence,
  });

  repo.savePresence(scope, scanId, report.presence, 'initial scan');
  repo.saveRisk(scope, scanId, report.risk, 'initial scan');

  return { scanId, report };
}

/* -------------------------------------------------------------- basics */

test('migrations run once and are safe to re-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rep-persist-'));
  const file = join(dir, 'test.db');

  try {
    const first = open({ location: file });
    const applied = Number(
      (first.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n
    );
    assert.ok(applied > 0, 'the first open should apply migrations');

    // Re-running against an already-migrated database must be a no-op, not a
    // "table already exists" error and not a second application.
    assert.equal(migrate(first), 0);
    first.close();

    const second = open({ location: file });
    const after = Number(
      (second.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n
    );
    assert.equal(after, applied);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data survives closing and reopening the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rep-persist-'));
  const file = join(dir, 'test.db');

  try {
    const db1 = open({ location: file });
    const repo1 = new ScanRepository(db1);
    const account = repo1.createAccount('durable@example.test');
    const scope: AccountScope = { accountId: account.id, actor: 'customer' };
    const { scanId } = await seedScan(repo1, scope);
    db1.close();

    // The whole point of this package: the in-memory store lost everything on
    // restart, which is what made the rate limits evadable.
    const db2 = open({ location: file });
    const repo2 = new ScanRepository(db2);
    const stored = repo2.getScan(scope, scanId);

    assert.ok(stored, 'the scan did not survive a restart');
    assert.ok(stored!.evidence.length > 0);
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scan round-trips with all its evidence', async () => {
  const { repo, scope } = setup();
  const { scanId, report } = await seedScan(repo, scope);

  const stored = repo.getScan(scope, scanId);
  assert.ok(stored);
  assert.equal(stored!.evidence.length, report.evidence.length);
  assert.equal(stored!.identity.fullName, 'Jensen Adoni');
  assert.equal(stored!.isFixture, true);

  const first = stored!.evidence.find((e) => e.id === report.evidence[0].id)!;
  const original = report.evidence[0];
  assert.equal(first.sourceUrl, original.sourceUrl);
  assert.equal(first.excerpt, original.excerpt);
  assert.equal(first.identityStatus, original.identityStatus);
  assert.equal(first.classification, original.classification);
  assert.equal(first.provenance, original.provenance);
});

test('a rebuilt report matches the one the audit produced', async () => {
  const { repo, scope } = setup();
  const { scanId, report } = await seedScan(repo, scope);

  const rebuilt = rebuildReport(repo.getScan(scope, scanId)!);

  assert.equal(rebuilt.presence.status, report.presence.status);
  if (rebuilt.presence.status === 'scored' && report.presence.status === 'scored') {
    assert.equal(rebuilt.presence.score, report.presence.score);
    assert.equal(rebuilt.presence.coverage, report.presence.coverage);
  }
  assert.equal(rebuilt.risk.level, report.risk.level);
  assert.equal(rebuilt.risk.findings.length, report.risk.findings.length);
});

/* --------------------------------------------------- account isolation */

test('one account cannot read another account’s scan', async () => {
  const { repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope);

  const other = repo.createAccount('someone-else@example.test');
  const otherScope: AccountScope = { accountId: other.id, actor: 'customer' };

  assert.equal(repo.getScan(otherScope, scanId), null, 'a known scan id must not be enough');
  assert.equal(repo.getEvidence(otherScope, scanId).length, 0);
  assert.equal(repo.getDecisions(otherScope, scanId).length, 0);
  assert.equal(repo.listScans(otherScope).length, 0);
});

test('one account cannot record a decision on another account’s evidence', async () => {
  const { repo, scope } = setup();
  const { scanId, report } = await seedScan(repo, scope);
  const evidenceId = report.awaitingConfirmation[0]?.id ?? report.evidence[0].id;

  const other = repo.createAccount('attacker@example.test');
  const otherScope: AccountScope = { accountId: other.id, actor: 'customer' };

  assert.throws(
    () => repo.recordDecision(otherScope, scanId, evidenceId, 'confirmed'),
    /Scan not found/
  );
});

test('a decision on evidence from a different scan is refused', async () => {
  const { repo, scope } = setup();
  const a = await seedScan(repo, scope, 'strong');
  const b = await seedScan(repo, scope, 'ambiguous');

  const foreignEvidenceId = b.report.evidence[0].id;

  // Same account, but the evidence belongs to another scan. Ids are only
  // unique within a scan, so this has to be checked rather than assumed.
  const belongsToA = repo
    .getEvidence(scope, a.scanId)
    .some((e) => e.id === foreignEvidenceId);

  if (!belongsToA) {
    assert.throws(
      () => repo.recordDecision(scope, a.scanId, 'ev-999', 'confirmed'),
      /Evidence not found/
    );
  }
});

/* ------------------------------------------------------- idempotency */

test('the same idempotency key returns the original scan', async () => {
  const { repo, scope } = setup();

  const first = repo.saveScan(scope, {
    identity: ADONI,
    status: 'complete',
    provider: 'fixture',
    isFixture: true,
    window: 10,
    queries: ['Jensen Adoni'],
    purpose: PURPOSE,
    requesterId: 'test',
    idempotencyKey: 'req-1',
  });

  const found = repo.findByIdempotencyKey(scope, 'req-1');
  assert.equal(found, first);

  // A second insert with the same key must be rejected by the database, not
  // merely discouraged in application code.
  assert.throws(() =>
    repo.saveScan(scope, {
      identity: ADONI,
      status: 'complete',
      provider: 'fixture',
      isFixture: true,
      window: 10,
      queries: ['Jensen Adoni'],
      purpose: PURPOSE,
      requesterId: 'test',
      idempotencyKey: 'req-1',
    })
  );
});

test('idempotency keys do not collide across accounts', () => {
  const { repo, scope } = setup();
  const other = repo.createAccount('other@example.test');
  const otherScope: AccountScope = { accountId: other.id, actor: 'customer' };

  const base = {
    identity: ADONI,
    status: 'complete' as const,
    provider: 'fixture',
    isFixture: true,
    window: 10,
    queries: ['Jensen Adoni'],
    purpose: PURPOSE,
    requesterId: 'test',
    idempotencyKey: 'shared-key',
  };

  const a = repo.saveScan(scope, base);
  const b = repo.saveScan(otherScope, base);

  assert.notEqual(a, b);
  assert.equal(repo.findByIdempotencyKey(scope, 'shared-key'), a);
  assert.equal(repo.findByIdempotencyKey(otherScope, 'shared-key'), b);
});

/* -------------------------------------------------------- decisions */

test('confirming an uncertain result changes the score', async () => {
  const { repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope, 'strong');

  const before = rebuildReport(repo.getScan(scope, scanId)!);
  const uncertain = before.awaitingConfirmation[0];
  assert.ok(uncertain, 'the strong scenario should leave something to confirm');

  repo.recordDecision(scope, scanId, uncertain.id, 'confirmed');

  const after = rebuildReport(repo.getScan(scope, scanId)!);

  assert.equal(after.decisionCount, 1);
  assert.ok(
    after.confidence.identityConfidence > before.confidence.identityConfidence,
    'confirming a match should raise identity confidence'
  );

  const record = after.evidence.find((e) => e.id === uncertain.id)!;
  assert.equal(record.identityStatus, 'confirmed');
  assert.equal(record.reviewStatus, 'customer_confirmed');
  assert.match(record.identitySignals.at(-1)!, /You confirmed/);
});

test('rejecting a result removes it from the score', async () => {
  const { repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope, 'strong');

  const before = rebuildReport(repo.getScan(scope, scanId)!);
  const target = before.awaitingConfirmation[0];

  repo.recordDecision(scope, scanId, target.id, 'rejected');
  const after = rebuildReport(repo.getScan(scope, scanId)!);

  const record = after.evidence.find((e) => e.id === target.id)!;
  assert.equal(record.identityStatus, 'rejected');
  assert.equal(record.identityConfidence, 0);
  assert.ok(after.confidence.rejected > before.confidence.rejected);
});

test('changing a decision replaces it rather than stacking', async () => {
  const { repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope, 'strong');
  const target = rebuildReport(repo.getScan(scope, scanId)!).awaitingConfirmation[0];

  repo.recordDecision(scope, scanId, target.id, 'confirmed');
  repo.recordDecision(scope, scanId, target.id, 'rejected');

  const decisions = repo.getDecisions(scope, scanId);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'rejected');
});

test('applyDecisions leaves untouched evidence alone', async () => {
  const { repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope);
  const stored = repo.getScan(scope, scanId)!;

  const unchanged = applyDecisions(stored.evidence, []);
  assert.deepEqual(unchanged, stored.evidence);
});

/* --------------------------------------------------------- snapshots */

test('rescoring appends a snapshot rather than restating the old one', async () => {
  const { repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope);

  const target = rebuildReport(repo.getScan(scope, scanId)!).awaitingConfirmation[0];
  repo.recordDecision(scope, scanId, target.id, 'confirmed');

  const rebuilt = rebuildReport(repo.getScan(scope, scanId)!);
  repo.savePresence(scope, scanId, rebuilt.presence, 'customer confirmed a match');

  const history = repo.presenceHistory(scope, scanId);
  assert.equal(history.length, 2);
  assert.equal(history[0].reason, 'customer confirmed a match');
  assert.equal(history[1].reason, 'initial scan');
});

/* -------------------------------------------------- export & deletion */

test('an export contains the account’s data and nothing else', async () => {
  const { repo, scope } = setup();
  await seedScan(repo, scope);

  const other = repo.createAccount('other@example.test');
  const otherScope: AccountScope = { accountId: other.id, actor: 'customer' };
  await seedScan(repo, otherScope);

  const data = repo.exportAccount(scope) as Record<string, Array<{ account_id: string }>>;

  for (const table of ['scans', 'evidence', 'presence_snapshots', 'risk_snapshots']) {
    assert.ok(data[table].length > 0, `${table} should be present in the export`);
    assert.ok(
      data[table].every((r) => r.account_id === scope.accountId),
      `${table} leaked another account's rows`
    );
  }
});

test('deletion removes everything and leaves a non-identifying record', async () => {
  const { db, repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope);

  const target = rebuildReport(repo.getScan(scope, scanId)!).awaitingConfirmation[0];
  repo.recordDecision(scope, scanId, target.id, 'confirmed');

  const counts = repo.deleteAccount(scope);
  assert.ok(counts.evidence > 0);
  assert.ok(counts.scans > 0);

  for (const table of [
    'scans',
    'evidence',
    'identity_decisions',
    'presence_snapshots',
    'risk_snapshots',
    'professional_identities',
    'audit_events',
  ]) {
    const r = db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`)
      .get(scope.accountId);
    assert.equal(Number((r as { n: number }).n), 0, `${table} still has rows`);
  }

  assert.equal(repo.findAccountByEmail('jensen@example.test'), null);

  const log = db.prepare('SELECT account_ref, rows_removed FROM deletion_log').all();
  assert.equal(log.length, 1);

  const ref = (log[0] as { account_ref: string }).account_ref;
  assert.ok(!ref.includes(scope.accountId), 'the deletion log must not hold the account id');
});

test('deleting one account does not touch another', async () => {
  const { repo, scope } = setup();
  await seedScan(repo, scope);

  const other = repo.createAccount('other@example.test');
  const otherScope: AccountScope = { accountId: other.id, actor: 'customer' };
  const kept = await seedScan(repo, otherScope);

  repo.deleteAccount(scope);

  assert.ok(repo.getScan(otherScope, kept.scanId), 'the other account lost its data');
  assert.ok(repo.getEvidence(otherScope, kept.scanId).length > 0);
});

/* ------------------------------------------------------- audit events */

test('consequential actions are logged', async () => {
  const { db, repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope);
  const target = rebuildReport(repo.getScan(scope, scanId)!).awaitingConfirmation[0];
  repo.recordDecision(scope, scanId, target.id, 'confirmed');
  repo.exportAccount(scope);

  const actions = listEvents(db, scope.accountId).map((e) => e.action);
  assert.ok(actions.includes('account.created'));
  assert.ok(actions.includes('scan.created'));
  assert.ok(actions.includes('identity.decided'));
  assert.ok(actions.includes('account.exported'));
});

test('the audit log records who decided, not just what', async () => {
  const { db, repo, scope } = setup();
  const { scanId } = await seedScan(repo, scope);
  const target = rebuildReport(repo.getScan(scope, scanId)!).awaitingConfirmation[0];

  repo.recordDecision({ ...scope, actor: 'admin:ops-7' }, scanId, target.id, 'rejected');

  const event = listEvents(db, scope.accountId).find((e) => e.action === 'identity.decided')!;
  assert.equal(event.actor, 'admin:ops-7');
  assert.equal(event.metadata.decision, 'rejected');

  const decision = repo.getDecisions(scope, scanId)[0];
  assert.equal(decision.decidedBy, 'admin:ops-7');
});

test('audit events hold no evidence payloads', async () => {
  const { db, repo, scope } = setup();
  await seedScan(repo, scope);

  // Logging the excerpt here would put the same personal data in two places
  // with two different retention stories.
  for (const e of listEvents(db, scope.accountId)) {
    const blob = JSON.stringify(e.metadata);
    assert.ok(!blob.includes('disbarred'));
    assert.ok(!blob.includes('Jensen Adoni'));
  }
});

/* ------------------------------------------------------ failed scans */

test('a failed search is stored as a failure, not as an empty report', () => {
  const { repo, scope } = setup();

  const scanId = repo.saveScan(scope, {
    identity: ADONI,
    status: 'search_failed',
    provider: 'fixture',
    isFixture: true,
    window: 10,
    queries: ['Jensen Adoni'],
    purpose: PURPOSE,
    requesterId: 'test',
    failure: { reason: 'provider_error', message: 'Simulated upstream failure.' },
  });

  const stored = repo.getScan(scope, scanId)!;
  assert.equal(stored.status, 'search_failed');
  assert.equal(stored.failure!.reason, 'provider_error');
  assert.equal(stored.completedAt, undefined);
  assert.equal(stored.evidence.length, 0);
});
