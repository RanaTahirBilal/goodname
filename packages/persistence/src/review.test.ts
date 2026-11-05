import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import { ScanRepository, type AccountScope } from './repository.ts';
import { ReviewRepository, applyReviewDecisions } from './review.ts';
import { rebuildReport } from './report.ts';
import { listEvents } from './events.ts';
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
  websiteUrl: 'https://adoni-law.example',
};

async function setup(scenario = 'official_finding') {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const review = new ReviewRepository(db);

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

  const reviewer = review.createStaff('ops@example.test', 'reviewer');
  const rScope = review.scopeFor(reviewer.id)!;

  return { db, repo, review, scope, scanId, reviewer, rScope, report };
}

/* ------------------------------------------------------------- the queue */

test('flagged records reach the queue, and unflagged ones do not', async () => {
  const { review, rScope, report } = await setup();

  const queue = review.queue(rScope);
  assert.ok(queue.length > 0, 'the disciplinary scenario should flag something');

  const flaggedIds = report.evidence
    .filter((e) => e.reviewStatus === 'needs_human_review')
    .map((e) => e.id)
    .sort();

  assert.deepEqual(queue.map((q) => q.evidenceId).sort(), flaggedIds);
});

test('the queue says why each record is there', async () => {
  const { review, rScope } = await setup();

  for (const item of review.queue(rScope)) {
    assert.ok(item.flaggedBecause.length > 20, `no reason given for ${item.evidenceId}`);
  }
});

test('the queue carries no customer details beyond the record being judged', async () => {
  const { review, rScope } = await setup();
  const item = review.queue(rScope)[0];

  // A reviewer deciding whether a disbarment notice is the right person does
  // not need their email, their plan or their other scans.
  const keys = Object.keys(item);
  for (const leaked of ['email', 'customerName', 'plan', 'subscription', 'fullName']) {
    assert.ok(!keys.includes(leaked), `the queue item exposes ${leaked}`);
  }
});

test('a decided record leaves the queue', async () => {
  const { review, rScope, scanId } = await setup();
  const before = review.queue(rScope);
  const target = before[0];

  review.decide(rScope, scanId, target.evidenceId, 'uphold', 'Checked the court record; it matches.');

  const after = review.queue(rScope).map((q) => q.evidenceId);
  assert.ok(!after.includes(target.evidenceId));
  assert.equal(after.length, before.length - 1);
});

/* --------------------------------------------------------- the rationale */

test('a decision without a written reason is refused', async () => {
  const { review, rScope, scanId } = await setup();
  const target = review.queue(rScope)[0];

  // A judgement that moves someone's risk level and says nothing about why
  // cannot be reviewed by anybody else.
  assert.throws(
    () => review.decide(rScope, scanId, target.evidenceId, 'uphold', ''),
    /written reason/
  );
  assert.throws(
    () => review.decide(rScope, scanId, target.evidenceId, 'uphold', 'ok'),
    /written reason/
  );
});

test('the rationale is stored and attributed', async () => {
  const { review, rScope, scanId, reviewer } = await setup();
  const target = review.queue(rScope)[0];

  review.decide(
    rScope,
    scanId,
    target.evidenceId,
    'downgrade_to_allegation',
    'The commission page shows a pending hearing, not a decided matter.'
  );

  const [decision] = review.decisionsFor(scanId);
  assert.equal(decision.reviewerId, reviewer.id);
  assert.equal(decision.outcome, 'downgrade_to_allegation');
  assert.match(decision.rationale, /pending hearing/);
});

/* -------------------------------------------- the effect on the report */

test('rejecting a finding as the wrong person changes the customer’s report', async () => {
  const { repo, review, rScope, scope, scanId } = await setup();

  const before = rebuildReport(repo.getScan(scope, scanId)!, { reviews: [] });

  /**
   * The record starts unread, not severe. Rejecting it has to do two
   * distinct things, and only the second is about the risk level: it must
   * leave the customer's report, and it must stop being something waiting to
   * be read — otherwise the report goes on saying an assessment is
   * unfinished after the only outstanding item has been settled.
   */
  assert.equal(before.risk.level, 'none');
  assert.ok(before.risk.awaitingReview > 0);

  const finding = review
    .queue(rScope)
    .find((q) => q.findingStatus === 'requires_review')!;

  review.decide(
    rScope,
    scanId,
    finding.evidenceId,
    'reject_not_this_person',
    'Different middle initial and a different bar number. Not our customer.'
  );

  const after = rebuildReport(repo.getScan(scope, scanId)!, {
    reviews: review.decisionsFor(scanId),
  });

  assert.notEqual(after.risk.level, 'severe', 'the review did not reach the report');
  assert.equal(after.risk.awaitingReview, 0, 'a settled record is still reported as unread');
  assert.equal(after.reviewCount, 1);
});

test('downgrading a finding softens the level without hiding it', async () => {
  const { repo, review, rScope, scope, scanId } = await setup();
  const finding = review.queue(rScope).find((q) => q.findingStatus === 'requires_review')!;

  review.decide(
    rScope,
    scanId,
    finding.evidenceId,
    'downgrade_to_allegation',
    'Reported by one outlet with no official record behind it.'
  );

  const after = rebuildReport(repo.getScan(scope, scanId)!, {
    reviews: review.decisionsFor(scanId),
  });

  // Still visible, no longer stated as established.
  const stillThere = after.risk.findings.find((f) => f.evidenceId === finding.evidenceId);
  assert.ok(stillThere, 'a downgraded finding must not vanish');
  assert.equal(stillThere!.status, 'allegation');
});

/**
 * Upholding used to be a no-op on the record. It is now the thing that makes
 * a finding a finding.
 *
 * The classifier stopped writing `confirmed_finding` after the first
 * fulfillment rehearsal, where "No disciplinary actions are recorded against
 * this certificate" arrived already settled as a severity-3 finding. Adverse
 * material now lands at `requires_review` and contributes nothing to the
 * risk level. A named person reading it and writing down why is what moves
 * it, and this test is that promotion.
 */
test('upholding is what turns a detection into a finding', async () => {
  const { repo, review, rScope, scope, scanId } = await setup();

  const before = rebuildReport(repo.getScan(scope, scanId)!, { reviews: [] });
  assert.ok(before.risk.awaitingReview > 0, 'nothing was waiting to be read');
  assert.equal(before.risk.level, 'none', 'an unread record reached the level on its own');

  const finding = review.queue(rScope).find((q) => q.findingStatus === 'requires_review')!;

  review.decide(rScope, scanId, finding.evidenceId, 'uphold', 'Official record, correct person.');

  const after = rebuildReport(repo.getScan(scope, scanId)!, {
    reviews: review.decisionsFor(scanId),
  });

  const record = after.evidence.find((e) => e.id === finding.evidenceId)!;
  assert.equal(record.reviewStatus, 'reviewer_upheld');
  assert.equal(record.findingStatus, 'confirmed_finding', 'the reviewer upheld it into nothing');
  assert.notEqual(after.risk.level, 'none', 'an upheld disbarment never reaches the customer');
});

test('upholding an allegation does not quietly settle it', async () => {
  /**
   * Promotion is from `requires_review` only. A reviewer agreeing that a
   * newspaper's claim is reported accurately is not a finding that the claim
   * is true, and the one-line version of this change — "uphold sets
   * confirmed_finding" — would have made it one.
   */
  const { repo, review, rScope, scope, scanId } = await setup();

  const allegation = review.queue(rScope).find((q) => q.findingStatus === 'allegation');
  if (!allegation) return; // this fixture has none; the rule is asserted in domain tests

  review.decide(rScope, scanId, allegation.evidenceId, 'uphold', 'Accurately reported as claimed.');

  const after = rebuildReport(repo.getScan(scope, scanId)!, {
    reviews: review.decisionsFor(scanId),
  });

  const record = after.evidence.find((e) => e.id === allegation.evidenceId)!;
  assert.equal(record.findingStatus, 'allegation', 'an unsettled claim was settled by agreement');
});

test('the customer has the last word on whether a result is them', async () => {
  const { repo, review, rScope, scope, scanId } = await setup();
  const finding = review.queue(rScope).find((q) => q.findingStatus === 'requires_review')!;

  review.decide(rScope, scanId, finding.evidenceId, 'uphold', 'Official record, looks correct.');
  repo.recordDecision(scope, scanId, finding.evidenceId, 'rejected');

  const after = rebuildReport(repo.getScan(scope, scanId)!, {
    reviews: review.decisionsFor(scanId),
  });

  // A reviewer can be confident and still be wrong about which Jensen Adoni
  // this is. The person whose name it is gets the final say.
  const record = after.evidence.find((e) => e.id === finding.evidenceId)!;
  assert.equal(record.identityStatus, 'rejected');
  assert.equal(record.reviewStatus, 'customer_rejected');
});

/* ------------------------------------------------------------- the log */

test('every record a reviewer reads is logged, not just the ones decided', async () => {
  const { review, rScope, reviewer } = await setup();

  const queue = review.queue(rScope);
  const log = review.accessLog(reviewer.id);

  // A log of decisions alone misses the reviewer who read fifty records and
  // decided nothing, which is the access pattern worth noticing.
  assert.equal(log.filter((l) => l.action === 'listed').length, queue.length);
});

test('a decision is logged as access and as an audit event', async () => {
  const { db, review, rScope, scope, scanId, reviewer } = await setup();
  const target = review.queue(rScope)[0];

  review.decide(rScope, scanId, target.evidenceId, 'uphold', 'Verified against the source.');

  const access = review.accessLog(reviewer.id);
  assert.ok(access.some((l) => l.action === 'decided:uphold'));

  const events = listEvents(db, scope.accountId);
  const reviewed = events.find((e) => e.action === 'evidence.reviewed')!;
  assert.equal(reviewed.actor, `reviewer:${reviewer.id}`);
});

test('the audit event does not duplicate the rationale', async () => {
  const { db, review, rScope, scope, scanId } = await setup();
  const target = review.queue(rScope)[0];
  const rationale = 'A very specific sentence about the court record.';

  review.decide(rScope, scanId, target.evidenceId, 'uphold', rationale);

  // It lives in review_decisions. Copying it here would put the same
  // judgement in two places with two retention stories.
  const blob = JSON.stringify(listEvents(db, scope.accountId));
  assert.ok(!blob.includes(rationale));
});

/* ------------------------------------------------------------- staff */

test('a disabled reviewer has no scope', async () => {
  const { review, reviewer } = await setup();

  assert.ok(review.scopeFor(reviewer.id));
  review.disableStaff(reviewer.id);
  assert.equal(review.scopeFor(reviewer.id), null);
});

test('an unknown staff id has no scope', async () => {
  const { review } = await setup();
  assert.equal(review.scopeFor('staff_made_up'), null);
});

/* -------------------------------------------------- applying decisions */

test('applyReviewDecisions leaves untouched evidence alone', async () => {
  const { report } = await setup();
  assert.deepEqual(applyReviewDecisions(report.evidence, []), report.evidence);
});

test('the newest decision on a record wins', async () => {
  const { repo, review, rScope, scope, scanId } = await setup();
  const finding = review.queue(rScope).find((q) => q.findingStatus === 'requires_review')!;

  review.decide(rScope, scanId, finding.evidenceId, 'uphold', 'Looked right on first pass.');
  review.decide(
    rScope,
    scanId,
    finding.evidenceId,
    'reject_not_harm',
    'On a second look this is a procedural note, not a sanction.'
  );

  const after = rebuildReport(repo.getScan(scope, scanId)!, {
    reviews: review.decisionsFor(scanId),
  });

  const record = after.evidence.find((e) => e.id === finding.evidenceId)!;
  assert.equal(record.classification, 'commentary');
  assert.equal(record.severity, undefined);

  // Both judgements survive, so the sequence can be reconstructed later.
  assert.equal(review.decisionsFor(scanId).length, 2);
});

test('pending count reflects the queue', async () => {
  const { review, rScope, scanId } = await setup();
  const before = review.pendingCount();
  assert.ok(before > 0);

  const target = review.queue(rScope)[0];
  review.decide(rScope, scanId, target.evidenceId, 'uphold', 'Checked and correct.');

  assert.equal(review.pendingCount(), before - 1);
});

/* ---------------------------------------------- the customer's own answer */

/**
 * Two thirds of the review minutes in the first fulfillment rehearsal went
 * on records the customer had already resolved. She pressed "This is me" on
 * the Healthgrades and Doximity results; both stayed in the queue, shown to
 * a reviewer under "we are not certain this result is about the customer".
 *
 * Each one is also a crossing of the account boundary — the one operation in
 * this system that does that — logged against a named member of staff for no
 * reason. The cost is not only the minutes.
 */
test("a record the customer has claimed leaves the identity queue", async () => {
  // `ambiguous` is the scenario whose whole queue is identity questions.
  const { repo, review, rScope, scope, scanId } = await setup('ambiguous');

  const identityOnly = review.queue(rScope).find((q) => !q.findingStatus);

  if (!identityOnly) return assert.fail('this fixture no longer queues an identity-only record');

  repo.recordDecision(scope, scanId, identityOnly.evidenceId, 'confirmed');

  const after = review.queue(rScope).map((q) => q.evidenceId);
  assert.ok(
    !after.includes(identityOnly.evidenceId),
    'a reviewer is still being asked a question the customer answered'
  );
});

test('rejecting it as not them also closes the question', async () => {
  // The other answer settles it just as completely: a result the customer
  // says is somebody else is not one we need a reviewer to identify.
  const { repo, review, rScope, scope, scanId } = await setup('ambiguous');

  const before = review.queue(rScope);
  repo.recordDecision(scope, scanId, before[0]!.evidenceId, 'rejected');

  assert.equal(review.queue(rScope).length, before.length - 1);
});

test("a claimed record carrying adverse language stays in the queue", async () => {
  /**
   * The limit of the rule above, and the one that matters.
   *
   * "Yes, that is me" answers who the result is about. It says nothing about
   * whether the source establishes what we classified it as — and a customer
   * confirming identity on a disciplinary record must not be the thing that
   * removes it from human review. That would turn an answer into an
   * exemption.
   */
  const { repo, review, rScope, scope, scanId } = await setup();

  const adverse = review.queue(rScope).find((q) => q.findingStatus === 'requires_review')!;

  repo.recordDecision(scope, scanId, adverse.evidenceId, 'confirmed');

  const after = review.queue(rScope).map((q) => q.evidenceId);
  assert.ok(
    after.includes(adverse.evidenceId),
    'claiming a record as yours removed it from review'
  );
});

test('the pending count agrees with the queue', async () => {
  // They are two queries over the same question, and a dashboard saying "3
  // waiting" over a screen showing one is its own small dishonesty.
  const { repo, review, rScope, scope, scanId } = await setup('ambiguous');

  const identityOnly = review.queue(rScope).find((q) => !q.findingStatus);
  if (identityOnly) repo.recordDecision(scope, scanId, identityOnly.evidenceId, 'confirmed');

  assert.equal(review.pendingCount(), review.queue(rScope).length);
});
