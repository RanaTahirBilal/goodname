/**
 * Prints an audit report for one fixture scenario.
 *
 *   node src/demo.ts [strong|official_finding|allegation|syndicated|
 *                     corroborated|retracted|employer_collision|ambiguous|
 *                     sparse|empty|provider_error|rate_limited]
 *
 * Exists so the pipeline can be inspected by a person, not only by the test
 * runner. Everything it prints is fixture data, and it says so.
 */
import { runAudit } from './audit.ts';
import { FixtureSearchProvider, type FixtureScenario } from './providers/fixture.ts';
import { SELF_AUDIT_ATTESTATION } from './safeguards.ts';
import type { AuditPurpose, ProfessionalIdentity, RiskLevel } from './contracts/types.ts';

const scenario = (process.argv[2] ?? 'strong') as FixtureScenario;

const identity: ProfessionalIdentity = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  region: 'Illinois',
  credentials: ['JD'],
  websiteUrl: 'https://adoni-law.example',
};

const purpose: AuditPurpose = {
  kind: 'self_audit',
  attestationText: SELF_AUDIT_ATTESTATION,
  attestedAt: new Date().toISOString(),
  verification: 'verified_email',
};

const bar = (v: number, width = 22): string =>
  '█'.repeat(Math.round(v * width)) + '·'.repeat(width - Math.round(v * width));

const RISK_LABEL: Record<RiskLevel, string> = {
  none: 'No significant risk found',
  low: 'Low',
  elevated: 'Elevated',
  high: 'High',
  severe: 'Severe',
};

const report = await runAudit({
  identity,
  purpose,
  provider: new FixtureSearchProvider(scenario),
  websiteChecks: [
    { key: 'https', passed: true },
    { key: 'title', passed: true },
    { key: 'meta_description', passed: false },
    { key: 'structured_data', passed: true },
  ],
});

console.log(`\n  Scenario: ${scenario}\n`);

if (report.status === 'invalid_input') {
  console.log('  Invalid input:');
  for (const i of report.issues) console.log(`    ${i.field}: ${i.message}`);
  process.exit(0);
}

if (report.status === 'not_permitted') {
  console.log(`  Blocked by safeguards (${report.reason}): ${report.message}`);
  process.exit(0);
}

if (report.status === 'search_failed') {
  console.log(`  Search failed (${report.reason}): ${report.message}`);
  console.log('  No report is produced. An empty one would imply we looked and found nothing.');
  process.exit(0);
}

console.log(
  `  ${report.scan.resultsObserved} results observed, ${report.scan.resultsAttributed} attributed`
);
if (report.scan.isFixture) console.log('  ⚠ FIXTURE DATA, not live search results');

/* ----------------------------------------------- A. Online Presence Score */

console.log('\n  ── A. ONLINE PRESENCE ' + '─'.repeat(42));
const p = report.presence;

if (p.status === 'insufficient_evidence') {
  console.log(`  No score. Coverage ${Math.round(p.coverage * 100)}%, below the 55% minimum.`);
  for (const h of p.whatWouldHelp) console.log(`    · ${h}`);
} else {
  console.log(`  ${p.score}/100   coverage ${Math.round(p.coverage * 100)}%   (${p.methodologyVersion})`);
  console.log();
  for (const d of p.dimensions) {
    const v = d.value === null ? '  n/a' : `${Math.round(d.value * 100)}`.padStart(5);
    const g = d.value === null ? '(not applicable)' : bar(d.value);
    console.log(`  ${d.code}  ${d.label.padEnd(34)} ${v}  ${g}`);
    console.log(`     ${d.explanation}`);
  }
}

/* ------------------------------------------------ B. Reputation Risk */

console.log('\n  ── B. REPUTATION RISK ' + '─'.repeat(42));
const r = report.risk;
console.log(`  ${RISK_LABEL[r.level].toUpperCase()}`);
console.log(`  ${r.levelRationale}`);

if (r.findings.length) {
  console.log('\n  Findings:');
  for (const f of r.findings) {
    console.log(`    [${f.status}] severity ${f.severity}/5 · ${f.sourceName} · ${f.corroboratingSources} independent source(s)`);
    console.log(`      ${f.headline}`);
    console.log(`      ${f.note}`);
    console.log(`      ${f.sourceUrl}`);
  }
}

if (r.needsReview.length) {
  console.log('\n  Excluded from the level, shown for completeness:');
  for (const f of r.needsReview) console.log(`    [${f.status}] ${f.headline}: ${f.note}`);
}

if (r.commentary.length) {
  console.log('\n  Commentary (not counted as harm):');
  for (const f of r.commentary) console.log(`    ${f.headline}: ${f.sourceName}`);
}

console.log(`\n  Privacy: ${r.privacy.level}: ${r.privacy.note}`);

/* ------------------------------------------------------- C. Confidence */

console.log('\n  ── C. CONFIDENCE ' + '─'.repeat(47));
const c = report.confidence;
console.log(
  `  Identity ${c.identityConfidence.toFixed(2)} (${c.band})   ` +
    `${c.attributed} attributed · ${c.awaitingConfirmation} to confirm · ${c.rejected} rejected`
);
console.log(`  ${c.note}`);
if (c.needsHumanReview.length) {
  console.log(`  ${c.needsHumanReview.length} record(s) flagged for human review.`);
}

if (report.awaitingConfirmation.length) {
  console.log('\n  Is this you?');
  for (const e of report.awaitingConfirmation) {
    console.log(`    [${e.identityConfidence.toFixed(2)}] ${e.title}`);
    console.log(`           ${e.sourceUrl}`);
  }
}

/* --------------------------------------------------- recommendations */

console.log('\n  ── RECOMMENDATIONS ' + '─'.repeat(45));
for (const rec of report.recommendations) {
  console.log(`  [${rec.priority}] ${rec.title}`);
  console.log(`     ${rec.why}`);
  if (rec.caveat) console.log(`     Note: ${rec.caveat}`);
}

console.log();
