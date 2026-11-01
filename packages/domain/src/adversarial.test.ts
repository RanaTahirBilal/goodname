/**
 * Adversarial tests.
 *
 * Each case is a way the pipeline could say something false about a real
 * person. These are the tests that matter: a scoring bug produces a wrong
 * number, but a classification bug produces a defamatory sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditPurpose, EvidenceRecord } from './contracts/types.ts';
import { runAudit } from './audit.ts';
import { FixtureSearchProvider } from './providers/fixture.ts';
import { SELF_AUDIT_ATTESTATION } from './safeguards.ts';
import { ADONI } from './testing/factories.ts';

const PURPOSE: AuditPurpose = {
  kind: 'self_audit',
  attestationText: SELF_AUDIT_ATTESTATION,
  attestedAt: '2026-10-29T00:00:00.000Z',
  verification: 'verified_email',
};

const audit = (scenario: Parameters<typeof FixtureSearchProvider.prototype.search> extends never ? never : string) =>
  runAudit({
    identity: ADONI,
    purpose: PURPOSE,
    provider: new FixtureSearchProvider(scenario as never),
    websiteChecks: [
      { key: 'https', passed: true },
      { key: 'title', passed: true },
    ],
  });

/* ------------------------------------------- allegation versus finding */

test('a hedged accusation is reported as an allegation, never as a finding', async () => {
  const report = await audit('allegation');
  if (report.status !== 'complete') return assert.fail('expected a report');

  const finding = report.risk.findings.find((f) => f.headline.includes('accused'));
  assert.ok(finding, 'the claim should be surfaced, not hidden');
  assert.equal(finding!.status, 'allegation');
  assert.notEqual(report.risk.level, 'severe');
  assert.match(finding!.note, /not established/i);
});

test('an official record is treated as an established finding', async () => {
  const report = await audit('official_finding');
  if (report.status !== 'complete') return assert.fail('expected a report');

  assert.equal(report.risk.level, 'severe');
  const finding = report.risk.findings[0];
  assert.equal(finding.status, 'confirmed_finding');
  assert.equal(finding.reliability, 'official');
});

test('a severe finding leaves the presence score intact and visible', async () => {
  const report = await audit('official_finding');
  if (report.status !== 'complete') return assert.fail('expected a report');

  // The two outputs are independent: a strong presence and a severe problem
  // can coexist, and the report must be able to say both.
  assert.equal(report.presence.status, 'scored');
  if (report.presence.status !== 'scored') return;
  assert.ok(report.presence.score > 0);
  assert.equal(report.risk.level, 'severe');
});

/* ----------------------------------------------- duplicates and sources */

test('one wire story in three outlets is one finding, not three sources', async () => {
  const report = await audit('syndicated');
  if (report.status !== 'complete') return assert.fail('expected a report');

  const findings = report.risk.findings;
  assert.equal(findings.length, 1, 'three reprints are one story');
  assert.equal(
    findings[0].corroboratingSources,
    1,
    'syndication must not read as independent corroboration'
  );
  assert.equal(findings[0].status, 'allegation', 'and so must not be promoted');
});

test('two independently written reports do corroborate', async () => {
  const report = await audit('corroborated');
  if (report.status !== 'complete') return assert.fail('expected a report');

  const findings = report.risk.findings;
  assert.equal(findings.length, 1);
  assert.ok(findings[0].corroboratingSources >= 2, 'different wording, same event');
  assert.equal(findings[0].status, 'confirmed_finding');
});

/* ---------------------------------------------- corrections and disputes */

test('a retracted story stops being a finding but is still shown', async () => {
  const report = await audit('retracted');
  if (report.status !== 'complete') return assert.fail('expected a report');

  assert.equal(report.risk.findings.length, 0, 'a withdrawn claim is not a finding');
  assert.ok(report.risk.needsReview.length > 0, 'but it must not vanish either');
  assert.notEqual(report.risk.level, 'severe');

  const original = report.evidence.find((e) => e.sourceUrl.includes('adoni-indicted'));
  assert.equal(original!.findingStatus, 'retracted');
  assert.ok(original!.contradictedBy!.length > 0, 'the retraction is linked to what it withdrew');
});

/* ------------------------------------------------------ identity errors */

test('a firm named after the person does not attribute firm-wide news to them', async () => {
  const report = await audit('employer_collision');
  if (report.status !== 'complete') return assert.fail('expected a report');

  const sanction = report.evidence.find((e) => e.sourceUrl.includes('adoni-law-sanctioned'));
  assert.ok(sanction, 'the result should be present in the evidence');
  assert.equal(
    sanction!.identityStatus,
    'rejected',
    'a sanction against the firm is not a sanction against the person'
  );
  assert.equal(report.risk.level, 'none');
});

test('a different person with the same name yields nothing attributed, and asks', async () => {
  const report = await audit('ambiguous');
  if (report.status !== 'complete') return assert.fail('expected a report');

  assert.equal(report.scan.resultsAttributed, 0);
  assert.ok(report.awaitingConfirmation.length > 0, 'the customer must be asked, not ignored');
  assert.equal(report.presence.status, 'insufficient_evidence');
  assert.equal(report.confidence.band, 'low');
  assert.match(report.confidence.note, /may not be you/i);
});

/* ------------------------------------------------- evidence and coverage */

test('every finding is traceable to an evidence record', async () => {
  const report = await audit('official_finding');
  if (report.status !== 'complete') return assert.fail('expected a report');

  for (const f of report.risk.findings) {
    const record: EvidenceRecord | undefined = report.evidence.find((e) => e.id === f.evidenceId);
    assert.ok(record, `finding ${f.evidenceId} has no evidence record`);
    assert.ok(record!.sourceUrl.length > 0);
    assert.ok(record!.retrievedAt.length > 0);
    assert.ok(record!.excerpt.length > 0);
    assert.ok(record!.identityConfidence > 0);
    assert.ok(record!.sourceReliability.length > 0);
    assert.ok(record!.classificationRationale.length > 0);
  }
});

test('fixture provenance is on every record and every output', async () => {
  const report = await audit('strong');
  if (report.status !== 'complete') return assert.fail('expected a report');

  assert.equal(report.scan.isFixture, true);
  assert.ok(report.evidence.every((e) => e.provenance === 'fixture'));
  assert.equal(report.risk.containsFixtureData, true);
  assert.equal(report.presence.containsFixtureData, true);
});

test('anything damaging or uncertain is flagged for human review', async () => {
  const report = await audit('official_finding');
  if (report.status !== 'complete') return assert.fail('expected a report');

  const finding = report.evidence.find((e) => e.findingStatus === 'confirmed_finding')!;
  assert.equal(finding.reviewStatus, 'needs_human_review');
  assert.ok(report.confidence.needsHumanReview.includes(finding.id));
});

/* ------------------------------------------------------- failure states */

test('a provider failure is never dressed up as an empty report', async () => {
  const report = await audit('provider_error');
  assert.equal(report.status, 'search_failed');
  if (report.status !== 'search_failed') return;
  assert.equal(report.reason, 'provider_error');
});

test('rate limiting is distinguishable from failure', async () => {
  const report = await audit('rate_limited');
  if (report.status !== 'search_failed') return assert.fail('expected a failure');
  assert.equal(report.reason, 'rate_limited');
  assert.equal(report.retryAfterSeconds, 60);
});

test('genuinely finding nothing is a complete report, not a failure', async () => {
  const report = await audit('empty');
  assert.equal(report.status, 'complete');
  if (report.status !== 'complete') return;

  assert.equal(report.scan.resultsObserved, 0);
  assert.equal(report.presence.status, 'insufficient_evidence');
  assert.equal(report.risk.level, 'none');
});

test('sparse evidence declines to score rather than returning a low one', async () => {
  const report = await audit('sparse');
  if (report.status !== 'complete') return assert.fail('expected a report');
  assert.equal(report.presence.status, 'insufficient_evidence');
});

/* ----------------------------------------------------- recommendations */

test('recommendations are evidence-backed and promise nothing', async () => {
  const report = await audit('official_finding');
  if (report.status !== 'complete') return assert.fail('expected a report');

  assert.ok(report.recommendations.length > 0);

  const urgent = report.recommendations.filter((r) => r.priority === 'now');
  assert.ok(urgent.length > 0, 'an established finding warrants an immediate recommendation');

  const aboutFinding = report.recommendations.find((r) => r.id.startsWith('review-'));
  assert.ok(aboutFinding!.evidenceIds.length > 0, 'it must name its evidence');
  assert.match(aboutFinding!.caveat!, /do not promise/i);

  const text = JSON.stringify(report.recommendations).toLowerCase();
  for (const forbidden of ['guarantee', 'guaranteed', 'we will remove', 'will rank']) {
    assert.ok(!text.includes(forbidden), `recommendations must not say "${forbidden}"`);
  }
});

test('identity confirmation is the first recommendation when attribution is weak', async () => {
  const report = await audit('ambiguous');
  if (report.status !== 'complete') return assert.fail('expected a report');

  assert.equal(report.recommendations[0].id, 'confirm-identity');
});
