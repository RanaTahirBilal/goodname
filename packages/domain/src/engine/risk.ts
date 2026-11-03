/**
 * Output B — the Reputation Risk Assessment.
 *
 * This deliberately produces **no aggregate number**. A single 0–100 cannot
 * distinguish an allegation from a conviction, or one syndicated story from
 * three independent ones, and averaging is exactly what lets a severe finding
 * vanish. A level plus the findings behind it is something a customer can act
 * on; a number is something they can only feel bad about.
 *
 * Four rules govern what reaches the level:
 *
 *   1. An allegation is never a finding. Promotion needs an official source,
 *      or two genuinely independent outlets.
 *   2. Syndication is not corroboration. Independence is counted per domain
 *      within a story cluster, not per document.
 *   3. A retraction or correction removes a claim from the level entirely and
 *      moves it to review. It is still shown — silently dropping it would
 *      hide the correction too.
 *   4. Criticism is not harm. Commentary is reported separately and never
 *      affects the level.
 */
import type {
  EvidenceRecord,
  PrivacyExposure,
  RiskAssessment,
  RiskFinding,
  RiskLevel,
} from '../contracts/types.ts';
import { prominence, ageInDays, recencyDecay } from './metrics.ts';

export const RISK_METHODOLOGY_VERSION = '1.0.0-provisional';

const LEVEL_ORDER: RiskLevel[] = ['none', 'low', 'elevated', 'high', 'severe'];

const downgrade = (level: RiskLevel, floor: RiskLevel = 'low'): RiskLevel => {
  const i = LEVEL_ORDER.indexOf(level);
  const f = LEVEL_ORDER.indexOf(floor);
  return LEVEL_ORDER[Math.max(f, i - 1)];
};

const highest = (levels: RiskLevel[]): RiskLevel =>
  levels.reduce<RiskLevel>(
    (hi, l) => (LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(hi) ? l : hi),
    'none'
  );

/**
 * Independent sources for this story, computed during clustering with
 * syndicated reprints already excluded. Recomputing it here by counting
 * domains would reintroduce exactly the bug clustering exists to prevent.
 */
const independentSources = (record: EvidenceRecord): number =>
  record.independentSourcesInCluster ?? 1;

function contradictionCount(record: EvidenceRecord): number {
  return record.contradictedBy?.length ?? 0;
}

const NOTES: Record<string, string> = {
  confirmed_finding:
    'An established finding from an official record or several independent sources.',
  allegation:
    'An unsettled claim. It has been asserted, not established — treat it as reported, not proven.',
  disputed:
    'Another source we found contradicts this. It is shown so you can see the disagreement.',
  corrected: 'The source has published a correction. The original claim should not stand alone.',
  retracted: 'The source withdrew this story. It is listed only so you know it existed.',
  opinion: 'Critical commentary rather than a factual claim. Not counted as reputational harm.',
  unverified: 'We could not establish what this is. Excluded from the risk level.',
};

function toFinding(record: EvidenceRecord): RiskFinding {
  const status = record.findingStatus ?? 'unverified';
  const corroborating = independentSources(record);

  return {
    evidenceId: record.id,
    headline: record.title,
    sourceName: record.sourceName,
    sourceUrl: record.sourceUrl,
    status,
    severity: record.severity ?? 0,
    severityRationale: record.severityRationale ?? 'No severity assigned.',
    prominence: prominence(record.position),
    recencyWeight: recencyDecay(ageInDays(record.publishedAt, record.retrievedAt)),
    reliability: record.sourceReliability,
    corroboratingSources: corroborating,
    contradictingSources: contradictionCount(record),
    requiresHumanReview: record.reviewStatus === 'needs_human_review',
    note: NOTES[status] ?? NOTES.unverified,
  };
}

/**
 * An allegation becomes a finding only with real corroboration: two or more
 * independent domains, all reporting it without hedging, none contradicting.
 * One wire story in eight outlets stays an allegation.
 */
function promote(finding: RiskFinding): RiskFinding {
  if (finding.status !== 'allegation') return finding;
  if (finding.contradictingSources > 0) return finding;
  if (finding.corroboratingSources < 2) return finding;
  if (finding.reliability !== 'high' && finding.reliability !== 'official') return finding;

  return {
    ...finding,
    status: 'confirmed_finding',
    severityRationale: `${finding.severityRationale} Corroborated by ${finding.corroboratingSources} independent sources.`,
    note: NOTES.confirmed_finding,
  };
}

function levelForFinding(f: RiskFinding): RiskLevel {
  if (f.status === 'confirmed_finding') {
    if (f.severity >= 5) return 'severe';
    if (f.severity >= 4) return 'high';
    if (f.severity >= 3 && f.prominence >= 0.5) return 'high';
    return 'elevated';
  }

  if (f.status === 'allegation') {
    return f.severity >= 4 ? 'elevated' : 'low';
  }

  if (f.status === 'disputed') return 'low';

  return 'none';
}

/**
 * Something old and buried is a smaller problem than something recent and
 * first. One level of relief, never below `low`, and never for a severe
 * finding — a conviction on page one of someone's name is not improved by
 * being from 2014.
 */
function applyAgeRelief(level: RiskLevel, f: RiskFinding): RiskLevel {
  if (level === 'severe') return level;
  const old = f.recencyWeight <= 0.56;
  const buried = f.prominence < 0.35;
  return old && buried ? downgrade(level) : level;
}

function assessPrivacy(records: EvidenceRecord[], assessed: boolean): PrivacyExposure {
  const exposures = records.filter((r) => r.classification === 'exposure');
  const count = exposures.length;

  const level: RiskLevel =
    count === 0 ? 'none' : count <= 2 ? 'low' : count <= 5 ? 'elevated' : 'high';

  return {
    assessed,
    exposedListings: count,
    level,
    evidenceIds: exposures.map((r) => r.id),
    note: !assessed
      ? 'No broker assessment has run, so this is only what ordinary search surfaced.'
      : count === 0
        ? 'No data-broker listings of your personal details were found.'
        : `${count} aggregator listing${count > 1 ? 's' : ''} expose personal details such as address, phone or relatives.`,
  };
}

export interface RiskInput {
  /** Attributed evidence only — unattributed results are not this person. */
  records: EvidenceRecord[];
  /** All records, for cluster and contradiction lookups. */
  allRecords: EvidenceRecord[];
  /** Whether a dedicated broker assessment ran, as opposed to plain search. */
  brokerAssessmentRan?: boolean;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const { records, allRecords } = input;
  const assessedAt = new Date().toISOString();

  // One finding per story. A syndicated copy is evidence of the same event,
  // not a second event.
  const primaries = records
    .filter((r) => r.duplicateOf === undefined)
    /**
     * Special-category material never becomes a risk finding.
     *
     * Someone's illness, faith, orientation or immigration history is not a
     * reputation risk, and reporting it as one would be this product doing
     * the harm it claims to measure. This is rule 10 taken to its
     * conclusion: negative is not harmful, and personal is not negative.
     *
     * The record still exists and still counts as a result that ranks for
     * the name. It contributes nothing to the level, the findings or the
     * severity, and its text was dropped before it ever got here.
     */
    .filter((r) => !r.sensitivity?.withhold);

  const negatives = primaries.filter((r) => r.classification === 'negative');
  const commentary = primaries
    .filter((r) => r.classification === 'commentary')
    .map((r) => toFinding(r));

  const all = negatives.map((r) => promote(toFinding(r)));

  const live = all.filter(
    (f) => f.status === 'confirmed_finding' || f.status === 'allegation' || f.status === 'disputed'
  );
  const needsReview = all.filter(
    (f) => f.status === 'corrected' || f.status === 'retracted' || f.status === 'unverified'
  );

  const levels = live.map((f) => applyAgeRelief(levelForFinding(f), f));
  const privacy = assessPrivacy(primaries, input.brokerAssessmentRan ?? false);

  const level = highest([...levels, privacy.level === 'high' ? 'elevated' : 'none']);

  return {
    methodologyVersion: RISK_METHODOLOGY_VERSION,
    level,
    levelRationale: rationaleFor(level, live, privacy),
    findings: live.sort(
      (a, b) =>
        LEVEL_ORDER.indexOf(levelForFinding(b)) - LEVEL_ORDER.indexOf(levelForFinding(a)) ||
        b.prominence - a.prominence
    ),
    commentary,
    privacy,
    needsReview,
    containsFixtureData: allRecords.some((r) => r.provenance === 'fixture'),
    assessedAt,
  };
}

function rationaleFor(level: RiskLevel, live: RiskFinding[], privacy: PrivacyExposure): string {
  if (level === 'none') {
    return 'Nothing in the results we searched asserts substantiated harm.';
  }

  const confirmed = live.filter((f) => f.status === 'confirmed_finding');
  const allegations = live.filter((f) => f.status === 'allegation');
  const disputed = live.filter((f) => f.status === 'disputed');

  const parts: string[] = [];
  if (confirmed.length) {
    parts.push(
      `${confirmed.length} established finding${confirmed.length > 1 ? 's' : ''} (highest severity ${Math.max(...confirmed.map((f) => f.severity))} of 5)`
    );
  }
  if (allegations.length) {
    parts.push(`${allegations.length} unsettled allegation${allegations.length > 1 ? 's' : ''}`);
  }
  if (disputed.length) {
    parts.push(`${disputed.length} disputed claim${disputed.length > 1 ? 's' : ''}`);
  }
  if (privacy.level === 'high' || privacy.level === 'elevated') {
    parts.push(`${privacy.exposedListings} data-broker listings`);
  }

  return parts.length ? `Based on ${parts.join(', ')}.` : 'Based on the findings listed.';
}
