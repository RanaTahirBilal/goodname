/**
 * Builds the evidence records that justify everything a report says.
 *
 * Three things happen here that cannot happen per-document:
 *   - story clustering, so syndication is not mistaken for corroboration
 *   - correction and retraction linking, so a withdrawn story stops counting
 *   - contradiction linking, so a disputed claim is reported as disputed
 *
 * Excerpts are carried verbatim from the provider. We never paraphrase a
 * source into a claim: a summary of an allegation reads like a finding.
 */
import type {
  EvidenceRecord,
  ProfessionalIdentity,
  Provenance,
  SearchResult,
  Authorship,
  Placement,
} from '../contracts/types.ts';
import { classify } from './classify.ts';
import { matchResult } from './identity.ts';
import { clusterStories, type Clusterable } from './dedupe.ts';
import {
  assessResult,
  WITHHELD_EXCERPT,
  WITHHELD_TITLE,
} from './sensitive.ts';

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Stable within one scan, which is all the id has to be. */
const idFor = (index: number): string => `ev-${String(index + 1).padStart(3, '0')}`;

export interface BuildEvidenceInput {
  results: SearchResult[];
  identity: ProfessionalIdentity;
  provenance: Provenance;
  /**
   * Material we placed for this customer, declared by the caller.
   *
   * Nothing in a search result says who commissioned it, so this cannot be
   * inferred and is not guessed at. An audit for somebody we have never
   * worked for passes nothing here and is scored exactly as before.
   */
  placements?: Placement[];
}

/**
 * The default: somebody else wrote it and a publication ran it.
 *
 * Chosen so that adding this field changes no existing score. The stronger
 * reading — that nothing counts as independent until independence has been
 * verified — would be more honest and would zero source authority for every
 * audit ever run, so it is a product decision rather than a refactor. See
 * OQ-21.
 */
const UNDECLARED: Authorship = {
  createdBy: 'third_party',
  distribution: 'editorial',
  editorialIndependence: 'not_verified',
};

/**
 * Matches a result against what we know we placed.
 *
 * URL before domain, because a customer's firm may host both a page we
 * wrote and twenty we did not, and the exact URL is the only one of the
 * two that can tell them apart.
 */
function authorshipFor(result: SearchResult, placements: Placement[]): Authorship {
  const host = result.domain || hostOf(result.url);

  const match =
    placements.find((p) => p.url && p.url === result.url) ??
    placements.find((p) => p.domain && p.domain === host);

  if (!match) return UNDECLARED;

  return {
    createdBy: match.createdBy,
    distribution: match.distribution,
    editorialIndependence: match.editorialIndependence ?? 'not_verified',
    campaignId: match.campaignId,
  };
}

export function buildEvidence(input: BuildEvidenceInput): EvidenceRecord[] {
  // De-duplicate identical URLs first: the same page returned for three query
  // terms is one piece of evidence, not three.
  const seen = new Set<string>();
  const unique = input.results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  const records: EvidenceRecord[] = unique.map((result, i) => {
    const identity = matchResult(result, input.identity);
    const c = classify(result, input.identity);

    return {
      id: idFor(i),
      sourceUrl: result.url,
      sourceName: result.sourceName ?? hostOf(result.url),
      domain: result.domain || hostOf(result.url),
      retrievedAt: result.observedAt,
      publishedAt: result.publishedAt,
      title: result.title,
      excerpt: result.snippet,
      position: result.position,

      provenance: result.isFixture ? 'fixture' : input.provenance,
      providerName: result.provider,

      authorship: authorshipFor(result, input.placements ?? []),

      identityConfidence: identity.confidence,
      identityStatus: identity.status,
      identitySignals: identity.signals,

      sourceReliability: c.reliability,
      authority: c.authority,

      classification: c.classification,
      classificationConfidence: c.confidence,
      classificationRationale: c.rationale,

      findingStatus: c.findingStatus,
      severity: c.severity,
      severityRationale: c.severityRationale,

      reviewStatus: needsReview(c.findingStatus, identity.status) ? 'needs_human_review' : 'auto',

      /**
       * An official record is never withheld, whatever words it contains.
       *
       * A disciplinary order that happens to mention a health condition is
       * still a disciplinary order, and it is the single most important
       * thing an audit can surface. Withholding it would not be privacy: it
       * would be the tool quietly declining to tell someone the one fact
       * ranking for their name, and a determination is Article 10 material
       * that the Article 9 rule was never about.
       *
       * This does not resolve the harder case — a newspaper covering a
       * conviction and an illness in one story, where withholding suppresses
       * a real finding and not withholding repeats a health disclosure.
       * `docs/OPEN_QUESTIONS.md` OQ-19 holds that one open rather than
       * pretending a keyword list settled it.
       */
      sensitivity:
        c.reliability === 'official'
          ? { categories: [], signals: ['official record: never withheld'], withhold: false }
          : assessResult(result),
    };
  });

  linkCorrections(records, unique);
  linkClusters(records);
  markDisputed(records);

  /**
   * Redaction happens last, and the order is not incidental.
   *
   * Clustering compares titles and excerpts to decide what is a reprint of
   * what. Redact first and every withheld record carries the same two
   * sentences, so the clusterer would read them as near-identical reprints
   * of one another and collapse unrelated results into a single story.
   *
   * So the text is used in memory, where it has to be anyway, and dropped
   * before any record leaves this function. `buildEvidence` is the only
   * thing that constructs an `EvidenceRecord`, which makes this the one
   * place that has to be right for the guarantee to hold.
   */
  return records.map(redactIfSensitive);
}

/**
 * Replaces the title and excerpt of a special-category record.
 *
 * Everything else survives: the URL, the source, the date, the position, the
 * fact that it ranks for this name. We are declining to keep a copy of the
 * text, not pretending the result does not exist.
 */
function redactIfSensitive(record: EvidenceRecord): EvidenceRecord {
  if (!record.sensitivity?.withhold) return record;

  return {
    ...record,
    title: WITHHELD_TITLE,
    excerpt: WITHHELD_EXCERPT,

    /**
     * And it leaves the human review queue.
     *
     * A reviewer cannot do anything useful with a withheld record. The text
     * is gone, so the only way to review it is to open the source — which
     * means sending a member of staff to read a customer's health or faith
     * coverage, on a record that contributes to nothing. The queue would be
     * creating the exposure the withholding exists to prevent.
     *
     * Identity is not lost with it: an uncertain record still reaches the
     * customer's own "Is this you?" step, which is where that question
     * belongs anyway.
     */
    reviewStatus: 'auto',
  };
}

/**
 * Anything that could damage someone, and anything we are unsure is them,
 * goes in front of a person before it is treated as settled.
 */
function needsReview(status: string | undefined, identityStatus: string): boolean {
  if (identityStatus === 'probable' || identityStatus === 'uncertain') return true;
  return (
    status === 'confirmed_finding' ||
    status === 'requires_review' ||
    status === 'allegation' ||
    status === 'disputed'
  );
}

/** A correction or retraction points back at what it supersedes. */
function linkCorrections(records: EvidenceRecord[], results: SearchResult[]): void {
  results.forEach((result, i) => {
    if (!result.correctsUrl) return;
    const target = records.find((r) => r.sourceUrl === result.correctsUrl);
    if (!target) return;

    records[i].correctionOf = target.id;

    // The superseded story stops being a live claim. Which it becomes depends
    // on whether the source withdrew it or merely fixed it.
    target.findingStatus = result.isRetraction ? 'retracted' : 'corrected';
    target.reviewStatus = 'needs_human_review';
    target.contradictedBy = [...(target.contradictedBy ?? []), records[i].id];
  });
}

function linkClusters(records: EvidenceRecord[]): void {
  const items: Clusterable[] = records.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.excerpt,
    domain: r.domain,
    publishedAt: r.publishedAt,
  }));

  for (const cluster of clusterStories(items)) {
    for (const id of cluster.memberIds) {
      const rec = records.find((r) => r.id === id)!;
      rec.independentSourcesInCluster = cluster.independentSources;

      if (cluster.memberIds.length === 1) continue;
      rec.storyClusterId = cluster.id;

      // Only near-identical reprints are duplicates. Two outlets writing
      // their own accounts of one event are two pieces of coverage.
      if (cluster.syndicatedIds.includes(id)) rec.duplicateOf = cluster.primaryId;
    }
  }
}

/**
 * Within one story cluster, a claim contradicted by another member is
 * reported as disputed rather than as a finding.
 */
function markDisputed(records: EvidenceRecord[]): void {
  for (const rec of records) {
    if (!rec.storyClusterId) continue;
    if (
      rec.findingStatus !== 'confirmed_finding' &&
      rec.findingStatus !== 'requires_review' &&
      rec.findingStatus !== 'allegation'
    ) {
      continue;
    }

    const siblings = records.filter(
      (r) => r.storyClusterId === rec.storyClusterId && r.id !== rec.id
    );

    const contradicting = siblings.filter(
      (s) => s.findingStatus === 'retracted' || s.findingStatus === 'corrected'
    );

    if (contradicting.length > 0) {
      rec.findingStatus = 'disputed';
      rec.contradictedBy = [
        ...(rec.contradictedBy ?? []),
        ...contradicting.map((c) => c.id),
      ];
      rec.reviewStatus = 'needs_human_review';
    }
  }
}

/** Records that inform the presence score: attributable to this person. */
export const attributed = (records: EvidenceRecord[]): EvidenceRecord[] =>
  records.filter((r) => r.identityStatus === 'confirmed' || r.identityStatus === 'probable');

/** Records the customer should be asked about rather than silently dropped. */
export const awaitingConfirmation = (records: EvidenceRecord[]): EvidenceRecord[] =>
  records.filter((r) => r.identityStatus === 'uncertain' || r.identityStatus === 'probable');
