/**
 * The landing page may not describe a report the engine would not produce.
 *
 * The hero card used to claim a score of 71, 88% coverage, three dimension
 * values and a risk level of Elevated. Every number was written by hand, and
 * no combination of them is one the engine produces for any subject. A small
 * dishonesty, on the one page whose entire argument is that this product
 * does not round things up, and a maintenance trap besides: change the
 * scoring and the marketing goes on quoting a report that no longer exists.
 *
 * The page runs a real audit now. These tests hold the two halves of that:
 * the figures are not written down anywhere, and the scenario it runs still
 * illustrates what it was chosen to illustrate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_SUBJECTS,
  FixtureSearchProvider,
  SELF_AUDIT_ATTESTATION,
  riskHeadline,
  runAudit,
  type AuditPurpose,
  type ProfessionalIdentity,
} from '@rep/domain';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '..', 'app', 'page.tsx'), 'utf8');

/** The same call the page makes. If this drifts, the tests below are fiction. */
async function example() {
  const s = FIXTURE_SUBJECTS.adoni;

  const identity: ProfessionalIdentity = {
    fullName: s.fullName,
    profession: s.profession as ProfessionalIdentity['profession'],
    employer: s.employer,
    city: s.city,
    region: s.region,
    credentials: s.credentials.split(', ').filter(Boolean),
    websiteUrl: s.websiteUrl,
  };

  const purpose: AuditPurpose = {
    kind: 'self_audit',
    attestationText: SELF_AUDIT_ATTESTATION,
    attestedAt: '2026-10-29T00:00:00.000Z',
    verification: 'verified_email',
  };

  return runAudit({ identity, purpose, provider: new FixtureSearchProvider('allegation') });
}

test('the page runs the engine rather than quoting it', () => {
  assert.match(page, /await runAudit\(/, 'the landing page no longer computes its example');
  assert.match(
    page,
    /new FixtureSearchProvider\('allegation'\)/,
    'the scenario changed; check the rest of this file still describes it'
  );
});

test('no figure in the hero is written by hand', () => {
  /**
   * The actual regression. Anything that looks like a score or a percentage
   * inside the preview is a number somebody typed, and a number somebody
   * typed is a number that stops being true without anybody noticing.
   */
  const preview = /function HeroPreview\(\{[\s\S]*$/.exec(page)?.[0];
  assert.ok(preview, 'HeroPreview has moved; this test needs rewriting');

  const literals = [...preview!.matchAll(/>\s*(\d{2,3})\s*</g)].map((m) => m[1]);
  assert.deepEqual(literals, [], 'a figure is hard-coded in the hero again');

  // The dimension names come from the engine too, so a renamed dimension
  // cannot leave the marketing page describing the old one.
  assert.match(preview!, /DIMENSION_LABELS\[d\.code\]/, 'dimension labels are hand-written');
});

test('the example still illustrates what it was chosen to illustrate', async () => {
  /**
   * A clean report is a worse hero for this product than one with something
   * unsettled in it, labelled as unsettled: that is the distinction the
   * claim ladder further down the page exists to explain. If the fixture
   * ever stops producing it, the hero quietly becomes an argument for
   * something else.
   */
  const report = await example();
  assert.equal(report.status, 'complete');
  if (report.status !== 'complete') return;

  assert.equal(report.presence.status, 'scored', 'the hero would render empty');
  assert.ok(report.risk.findings.length > 0, 'the example no longer shows anything unsettled');
  assert.equal(
    report.risk.findings[0]!.status,
    'allegation',
    'the example promoted its claim; it was chosen for showing one that is not established'
  );
});

test('the risk sentence is the report’s own', async () => {
  // Not a marketing paraphrase of it. `riskHeadline` is what the real report
  // renders, so the hero and the thing it is advertising say the same words.
  assert.match(page, /riskHeadline\(risk\)/, 'the hero writes its own risk copy');

  const report = await example();
  if (report.status !== 'complete') return assert.fail('expected a report');

  const headline = riskHeadline(report.risk);
  assert.ok(headline.label.length > 0 && headline.support.length > 0);
});

test('the subject is labelled as invented, not merely obvious', () => {
  // Rule 13 is not satisfied by the data being obviously fake to somebody
  // who already knows what fixture data is.
  assert.match(page, /Example report/);
  assert.match(page, /Invented person/);
});
