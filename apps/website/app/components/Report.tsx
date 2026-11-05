'use client';

import { useState } from 'react';
/**
 * The audit report.
 *
 * Layout follows the three outputs the engine produces, in the order a reader
 * needs them: what we found and how sure we are it is them, then presence,
 * then risk, then the evidence, then what to do.
 *
 * Glass appears on the presence score card alone. Findings, evidence, tables
 * and warnings sit on solid high-contrast surfaces — a frosted panel behind a
 * disciplinary record would be decoration getting in the way of the one thing
 * on the page that matters most.
 */
import type {
  BriefingFinding,
  ConfidenceReport,
  EvidenceRecord,
  FindingStatus,
  PresenceScore,
  Recommendation,
  RiskAssessment,
  RiskFinding,
  RiskLevel,
} from '@rep/domain';
import { DIMENSION_LABELS, splitFindings } from '@rep/domain';

type Scan = {
  provider: string;
  isFixture: boolean;
  queries: string[];
  window: number;
  observedAt: string;
  resultsObserved: number;
  resultsAttributed: number;
  partialCoverage: boolean;
  coverageNote?: string;
};

export interface CompleteReport {
  status: 'complete';
  scan: Scan;
  evidence: EvidenceRecord[];
  awaitingConfirmation: EvidenceRecord[];
  presence: PresenceScore;
  risk: RiskAssessment;
  confidence: ConfidenceReport;
  recommendations: Recommendation[];
  findings: BriefingFinding[];
}

/* ------------------------------------------------------------- helpers */

const pct = (v: number) => `${Math.round(v * 100)}%`;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const RISK_PILL: Record<RiskLevel, string> = {
  none: 'pill-success',
  low: 'pill-info',
  elevated: 'pill-warning',
  high: 'pill-danger',
  severe: 'pill-danger',
};

/** The level word is set in the level's own colour, at display size. */
const RISK_INK: Record<RiskLevel, string> = {
  none: 'var(--success)',
  low: 'var(--text)',
  elevated: 'var(--warning)',
  high: 'var(--danger)',
  severe: 'var(--danger)',
};

const RISK_WORD: Record<RiskLevel, string> = {
  none: 'None found',
  low: 'Low',
  elevated: 'Elevated',
  high: 'High',
  severe: 'Severe',
};

const STATUS_PILL: Record<FindingStatus, string> = {
  confirmed_finding: 'pill-danger',
  allegation: 'pill-warning',
  disputed: 'pill-warning',
  corrected: 'pill-neutral',
  retracted: 'pill-neutral',
  opinion: 'pill-info',
  unverified: 'pill-neutral',
};

/** Status is always stated in words, never carried by colour alone. */
const STATUS_WORD: Record<FindingStatus, string> = {
  confirmed_finding: 'Established finding',
  allegation: 'Allegation — not established',
  disputed: 'Disputed',
  corrected: 'Corrected by the source',
  retracted: 'Retracted by the source',
  opinion: 'Opinion',
  unverified: 'Unverified',
};

/**
 * The engine's attribution, in the reader's words.
 *
 * `confirmed` reads as "Matched" rather than "Confirmed" because this
 * product uses confirmation for something else and more specific: the
 * customer confirming a result is theirs. Two things called confirmed, one
 * decided by a classifier and one by the person the report is about, is a
 * distinction a reader has no way to recover from the label.
 */
const IDENTITY_WORD: Record<string, string> = {
  confirmed: 'Matched',
  probable: 'Probably you',
  uncertain: 'Unresolved',
  rejected: 'Not you',
};

/**
 * Category names in the reader's words.
 *
 * `racial_or_ethnic_origin` is the legal term and reads like one. Someone
 * looking at a report about themselves is owed a sentence, not a citation.
 */
const CATEGORY_WORD: Record<string, string> = {
  health: 'Health',
  religion: 'Religion or belief',
  political_opinion: 'Political views',
  sexual_orientation: 'Sexual orientation',
  racial_or_ethnic_origin: 'Race or ethnicity',
  trade_union: 'Union membership',
  immigration_status: 'Immigration status',
};

const categoryWord = (c: string): string => CATEGORY_WORD[c] ?? 'Personal information';

/* ------------------------------------------------------------ sections */

/**
 * Print, which in every modern browser also means save as PDF.
 *
 * Deliberately not labelled "Download PDF": it opens a print dialogue, and
 * naming it after a file the reader then has to choose to create would be
 * promising something this does not do by itself.
 */
function SaveButton() {
  return (
    <button
      type="button"
      className="btn btn-secondary no-print"
      onClick={() => window.print()}
      style={{ flex: '0 0 auto' }}
    >
      Print or save as PDF
    </button>
  );
}

export function FixtureBanner() {
  return (
    <div className="notice notice-warning" role="status">
      <span aria-hidden style={{ fontWeight: 700 }}>!</span>
      <div>
        <strong>This report is built from fixture data.</strong>
        No live search provider is connected yet, so every result below is test data
        standing in for a real search. Nothing here describes a real person.
      </div>
    </div>
  );
}

/**
 * The cover.
 *
 * Reading order, settled in the design review and implemented here:
 * subject, then how sure we are it is them, then the number, then what
 * the number was built from. The score used to lead, which made it the
 * most authoritative thing on a page where its own conditions were three
 * sections further down.
 *
 * The facts beside it are the conditions, not decoration. A score without
 * its coverage, its identity match and its date is presented as more
 * settled than it is, and this is the one place a reader is guaranteed to
 * look.
 */
function Cover({
  name,
  scan,
  presence,
  confidence,
}: {
  name: string;
  scan: Scan;
  presence: PresenceScore;
  confidence: ConfidenceReport;
}) {
  const seen = scan.resultsObserved;
  const attributed = confidence.attributed;

  return (
    <header className="cover">
      <div
        className="row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)', flexWrap: 'wrap' }}
      >
        <p className="eyebrow">Reputation briefing &middot; {when(scan.observedAt)}</p>
        {/**
         * Printing is the save button.
         *
         * Every browser's print dialogue offers "Save as PDF", so this is a
         * document export without a PDF library, a server round trip or a
         * second rendering that could drift from the first.
         */}
        <SaveButton />
      </div>

      <h1 style={{ marginTop: 'var(--s-6)' }}>{name}</h1>

      <p className="cover-sub" style={{ marginTop: 'var(--s-4)' }}>
        {seen === 0
          ? 'The search returned nothing for this name.'
          : `${seen} ${seen === 1 ? 'result' : 'results'} assessed, ${attributed} attributed.`}{' '}
        {scan.isFixture
          ? 'Built from fixture data: nothing here describes a real person.'
          : 'Every figure below carries the evidence it came from.'}
      </p>

      <dl className="cover-facts">
        <div>
          <dt>Identity</dt>
          <dd>
            {seen === 0 ? '—' : `${attributed} of ${seen}`}
          </dd>
        </div>
        <div>
          <dt>Model coverage</dt>
          <dd>{pct(confidence.evidenceCoverage)}</dd>
        </div>
        <div>
          <dt>Assessed</dt>
          <dd>{when(scan.observedAt)}</dd>
        </div>
        <div>
          <dt>Methodology</dt>
          <dd>
            {presence.methodologyVersion}
          </dd>
        </div>
      </dl>
    </header>
  );
}

/**
 * The number, alone, and one sentence the engine wrote.
 *
 * The sentence is `presence.meaning` — which the engine has always
 * produced and the report used to bury under the score as grey small
 * print. It is the only line here, because the alternative is composing a
 * better one in the interface, and a better one would be a conclusion
 * nobody computed.
 */
function Headline({ presence }: { presence: PresenceScore }) {
  if (presence.status !== 'scored') return null;

  return (
    <section className="figure-block">
      <p className="eyebrow mark">Online presence</p>
      <span className="figure-xl">{presence.score}</span>
      <p className="figure-said">{presence.meaning}</p>
      <p className="small" style={{ marginTop: 'var(--s-4)' }}>
        Out of 100, with {pct(presence.coverage)} of the model evaluated.
      </p>

      <div className="ribbon">
        {presence.dimensions.map((d) => (
          <div key={d.code} className="ribbon-cell">
            <div className="ribbon-n">
              {d.value === null ? '—' : Math.round(d.value * 100)}
            </div>
            <div className="lbl">{d.label}</div>
            <div className="ribbon-track">
              <span style={{ width: `${(d.value ?? 0) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The findings, however many there are.
 *
 * The mock had exactly three and looked composed. A real audit may produce
 * none, or twelve: none must not be padded, and twelve must not become
 * twelve full-page chapters nobody finishes. So the first three are
 * narrated and the rest are listed, which `splitFindings` decides in the
 * engine rather than the interface choosing which sounds most dramatic.
 *
 * Every sentence here came from `buildFindings`. Nothing is composed at
 * render time.
 */
function BriefingFindings({ findings }: { findings: BriefingFinding[] }) {
  if (findings.length === 0) {
    return (
      <section className="card">
        <p className="eyebrow mark">Findings</p>
        <h2 style={{ fontSize: '1.4rem', marginTop: 'var(--s-3)' }}>
          Nothing here needs your attention first
        </h2>
        <p className="small" style={{ marginTop: 'var(--s-3)' }}>
          The check completed and produced no finding worth raising above the rest of
          the report. The score, the risk assessment and the evidence are all below.
        </p>
      </section>
    );
  }

  const { narrative, remaining } = splitFindings(findings);

  return (
    <section>
      {narrative.map((f, i) => (
        <article key={f.id} className="finding">
          <p className="eyebrow">
            Finding {String(i + 1).padStart(2, '0')}
            {f.severity === 'priority' ? ' · priority' : ''}
          </p>
          <h3>{f.headline}</h3>
          <p className="small" style={{ marginTop: 'var(--s-4)', fontSize: '0.9375rem' }}>
            {f.detail}
          </p>

          <div className="finding-means">
            <p className="eyebrow">What that means</p>
            <p className="small" style={{ marginTop: 'var(--s-2)', color: 'var(--text)' }}>
              {f.meaning}
            </p>
          </div>

          {f.evidenceIds.length > 0 && (
            <p className="small" style={{ marginTop: 'var(--s-4)' }}>
              From {f.evidenceIds.length} piece
              {f.evidenceIds.length === 1 ? '' : 's'} of evidence, listed below.
            </p>
          )}
        </article>
      ))}

      {remaining.length > 0 && (
        <div style={{ marginTop: 'var(--s-12)' }}>
          <p className="eyebrow mark">
            {remaining.length} more finding{remaining.length === 1 ? '' : 's'}
          </p>
          {remaining.map((f, i) => (
            <div key={f.id} className="finding-row">
              <span className="n">{String(narrative.length + i + 1).padStart(2, '0')}</span>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{f.headline}</p>
                <p className="small" style={{ marginTop: 'var(--s-1)' }}>{f.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Who the report is about, before what it says about them.
 *
 * This slot used to hold "What we looked at" — provider, window, queries,
 * result counts — so the reader worked through *how the search ran* before
 * reaching anything about *whether it found them*. The provenance has not
 * been dropped: it moved into `AuditDetails` below the score, which is
 * where somebody checking the work looks and where a customer reading
 * their own report does not have to.
 *
 * It leads with counts rather than with the identity band, and that is
 * deliberate. The band comes from `identityConfidence`, which drops
 * rejected records from its own average and so reads "high" off a single
 * self-claimed URL; promoting a label that is currently wrong would have
 * made this change worse than no change at all. The counts do not go
 * through that filter. "1 of 8 attributed" is true, and it says the same
 * thing the band should have said.
 */
function IdentityHeader({
  scan,
  confidence,
}: {
  scan: Scan;
  confidence: ConfidenceReport;
}) {
  const attributed = confidence.attributed;
  const seen = scan.resultsObserved;

  /**
   * Derived, because `awaitingConfirmation` does not partition anything.
   *
   * It counts `uncertain` *and* `probable`, and `probable` is also counted
   * as attributed — deliberately, since those two answer different
   * questions: what is in the score, and what we would like you to confirm.
   * Printing both beside a total would show three figures that sum to more
   * than the results, which reads as an arithmetic error rather than as an
   * overlap. So the top block states a real partition and the breakdown
   * below keeps the overlapping view.
   */
  const unresolved = Math.max(0, seen - attributed - confidence.rejected);

  return (
    <div className="card" style={{ padding: 20 }}>
      <p className="eyebrow mark">Who this report is about</p>

      {/**
       * "0 of 0 results are attributed to you" is arithmetic, not an
       * answer. A search that returned nothing is a different fact from a
       * search that returned results belonging to somebody else, and the
       * sentence has to say which one happened.
       */}
      <p style={{ fontSize: '1.0625rem', marginBottom: 'var(--s-3)' }}>
        {seen === 0 ? (
          <strong>The search returned nothing for this name.</strong>
        ) : (
          <>
            <strong>
              {attributed} of {seen} {seen === 1 ? 'result' : 'results'}
            </strong>{' '}
            {attributed === 1 ? 'is' : 'are'} attributed to you.
          </>
        )}
      </p>

      <dl className="small cols cols-2" style={{ gap: '4px 20px' }}>
        <Pair label="Attributed to you" value={String(attributed)} />
        <Pair label="Not you" value={String(confidence.rejected)} />
        <Pair label="Still unresolved" value={String(unresolved)} />
        <Pair label="Model coverage" value={pct(confidence.evidenceCoverage)} />
      </dl>

      {/**
       * Stated rather than left to be inferred from a zero.
       *
       * A report headed with somebody's name, carrying a score, built from
       * nothing that is about them, is the failure this product exists to
       * avoid. When the count is zero it is said in words.
       */}
      {attributed === 0 && seen > 0 && (
        <p className="small" style={{ marginTop: 'var(--s-3)', color: 'var(--warning)' }}>
          Nothing we found appears to be about you. Anything below describes the results
          themselves, not your presence.
        </p>
      )}

      {seen === 0 && (
        <p className="small" style={{ marginTop: 'var(--s-3)' }}>
          That is a result in itself, and not the same as a search that failed — we looked
          and the queries came back empty.
        </p>
      )}

      <p className="small" style={{ marginTop: 'var(--s-3)' }}>
        A result counts as yours only when the evidence says so. Everything else is kept
        out of the score and listed separately, so you can see what we set aside.
      </p>
    </div>
  );
}

/**
 * The provenance, kept and demoted.
 *
 * Closed by default because it answers an auditor's question, not a
 * customer's. The print stylesheet forces it open: a saved PDF that omits
 * which provider ran which queries on what date is not a record of
 * anything.
 */
function AuditDetails({ scan }: { scan: Scan }) {
  return (
    <details className="card disclosure">
      <summary className="eyebrow">Audit details</summary>
      <div className="cols cols-2" style={{ gap: 16, marginTop: 'var(--s-4)' }}>
        <dl className="small stack" style={{ ['--gap' as string]: '6px' }}>
          <Pair label="Provider" value={`${scan.provider}${scan.isFixture ? ' (fixture)' : ''}`} />
          <Pair label="Observed" value={when(scan.observedAt)} />
          <Pair label="Window" value={`Top ${scan.window} results per query`} />
        </dl>
        <dl className="small stack" style={{ ['--gap' as string]: '6px' }}>
          <Pair label="Results seen" value={String(scan.resultsObserved)} />
          <Pair label="Attributed to you" value={String(scan.resultsAttributed)} />
          <Pair label="Queries" value={scan.queries.join(' · ')} />
        </dl>
      </div>
      {scan.partialCoverage && (
        <p className="small" style={{ marginTop: 12, color: 'var(--warning)' }}>
          Coverage was incomplete — some queries did not return a full set of results.
        </p>
      )}
      <p className="small" style={{ marginTop: 14 }}>
        An audit is a snapshot of what we could see at this moment, not an inventory of
        everything on the internet about you.
      </p>
    </details>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
      <dt style={{ minWidth: 112, color: 'var(--text-2)' }}>{label}</dt>
      <dd className="grow" style={{ color: 'var(--text)' }}>{value}</dd>
    </div>
  );
}

/** The one glass surface in the report. */
function PresenceCard({ presence }: { presence: PresenceScore }) {
  /**
   * A finished check with a limited conclusion, not a blank where a score
   * should be.
   *
   * This read "Not enough evidence to score" in the slot the number
   * normally fills, which made a deliberate refusal look like a report
   * that had failed to load. The decision is the product working: below
   * 55% coverage a number would be invented. So the state says plainly
   * that the check completed, how far it got, what it could not reach,
   * and the one thing that would change that.
   */
  if (presence.status === 'insufficient_evidence') {
    return (
      <div className="card stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <p className="eyebrow mark">Online presence</p>

        <h2 style={{ fontSize: '1.4rem' }}>
          We finished the check and did not score it
        </h2>

        <p className="small" style={{ fontSize: '0.9375rem' }}>
          We could evaluate <strong style={{ color: 'var(--text)' }}>{pct(presence.coverage)}</strong>{' '}
          of the model, and we do not publish a score below 55%. A number built on this
          little evidence would move on its own as more of it arrives, which is worse than
          no number at all.
        </p>

        {presence.missingDimensions.length > 0 && (
          <div>
            <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
              What we could not assess
            </p>
            <ul
              className="small stack"
              style={{ ['--gap' as string]: 'var(--s-1)', paddingLeft: 18 }}
            >
              {presence.missingDimensions.map((code) => (
                <li key={code}>{DIMENSION_LABELS[code]}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ paddingTop: 'var(--s-4)', borderTop: '1px solid var(--border)' }}>
          <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
            What would change it
          </p>
          <ul
            className="small stack"
            style={{ ['--gap' as string]: 'var(--s-2)', paddingLeft: 18 }}
          >
            {presence.whatWouldHelp.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>

        <p className="small">
          Everything below is still yours to read: the evidence we did find, where it came
          from and when we saw it.
        </p>
      </div>
    );
  }

  /**
   * A card, matching the risk panel beside it.
   *
   * These two sit in one grid row and used to be drawn differently — risk
   * bounded, presence loose on the page — which read as an oversight
   * rather than as emphasis. They are the report's two headline answers
   * and they are now a matched pair; the score keeps its primacy from
   * being the largest figure on the page, which is where emphasis should
   * come from.
   */
  return (
    <div className="card">
      <p className="eyebrow mark">Online presence</p>

      {/* The one big thing on the page. Everything else is medium or small. */}
      <div
        className="row"
        style={{ alignItems: 'baseline', gap: 'var(--s-3)', marginTop: 'var(--s-2)' }}
      >
        <span className="hero-figure">{presence.score}</span>
        <span className="small">out of 100</span>
      </div>

      <div className="meter meter-lg" style={{ margin: 'var(--s-4) 0 var(--s-2)', maxWidth: 420 }}>
        <span style={{ width: `${presence.score}%` }} />
      </div>
      <p className="small">{pct(presence.coverage)} of the model could be evaluated</p>

      <p style={{ marginTop: 'var(--s-4)', fontSize: '0.9375rem', color: 'var(--text-2)' }}>
        {presence.meaning}
      </p>

      <p className="small mono" style={{ marginTop: 'var(--s-3)' }}>
        methodology {presence.methodologyVersion} · provisional, not empirically validated
      </p>
    </div>
  );
}

function RiskCard({ risk }: { risk: RiskAssessment }) {
  return (
    <div className="card stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <p className="eyebrow mark">Reputation risk</p>

      {/*
        The level is set in words at display size rather than tucked into a
        pill. Severity carried only by a small coloured chip is severity a
        reader can skim past, and is invisible to anyone who cannot separate
        the hues.
      */}
      <p
        style={{
          fontFamily: 'var(--serif)',
          fontSize: '1.875rem',
          lineHeight: 1.1,
          fontWeight: 600,
          color: RISK_INK[risk.level],
        }}
      >
        {RISK_WORD[risk.level]}
      </p>

      <p style={{ fontSize: '0.9375rem' }}>{risk.levelRationale}</p>

      <div className="small" style={{ paddingTop: 'var(--s-4)', borderTop: '1px solid var(--border)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Privacy exposure</span>
          <span className={`pill ${RISK_PILL[risk.privacy.level]}`}>
            {RISK_WORD[risk.privacy.level]}
          </span>
        </div>
        <p style={{ marginTop: 'var(--s-1)' }}>{risk.privacy.note}</p>
      </div>

      <p className="small mono">
        methodology {risk.methodologyVersion} · deliberately not expressed as a single number
      </p>
    </div>
  );
}

function Dimensions({ presence }: { presence: PresenceScore }) {
  if (presence.status !== 'scored') return null;

  return (
    <section className="card stack" style={{ ['--gap' as string]: '18px' }}>
      <h2 style={{ fontSize: '1.25rem' }}>What makes up the score</h2>

      {/**
       * The explanations, without the numbers again.
       *
       * The ribbon on the cover already shows all five figures and their
       * bars. Repeating them here made the report read as padded, and
       * gave a reader two places to look for the same fact — which is
       * worse than one, because they have to check that the two agree.
       *
       * What the ribbon cannot carry is the engine's sentence for each
       * dimension, which is the thing somebody who scrolled this far came
       * for. So this section keeps the words and gives up the figures.
       */}
      {presence.dimensions.map((d) => (
        <div key={d.code}>
          <p style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
            {d.label}
            {d.value === null && (
              <span className="small" style={{ fontWeight: 400 }}> &mdash; not applicable</span>
            )}
          </p>
          <p className="small" style={{ marginTop: 'var(--s-1)' }}>{d.explanation}</p>
        </div>
      ))}

      <p className="small" style={{ paddingTop: 4 }}>
        Dimensions we could not evaluate are left out and the remaining weights are
        rebalanced, rather than counted as zero.
      </p>
    </section>
  );
}

function FindingRow({ finding, evidence }: { finding: RiskFinding; evidence: EvidenceRecord[] }) {
  const record = evidence.find((e) => e.id === finding.evidenceId);

  return (
    <article
      style={{
        padding: '18px 0',
        borderTop: '1px solid var(--border)',
      }}
    >
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className={`pill ${STATUS_PILL[finding.status]}`}>
          {STATUS_WORD[finding.status]}
        </span>
        {finding.severity > 0 && (
          <span className="pill pill-neutral">Severity {finding.severity} of 5</span>
        )}
        <span className="pill pill-neutral">
          {finding.corroboratingSources} independent source
          {finding.corroboratingSources === 1 ? '' : 's'}
        </span>
        {finding.requiresHumanReview && (
          <span className="pill pill-info">Awaiting human review</span>
        )}
      </div>

      <h3 style={{ marginBottom: 6 }}>{finding.headline}</h3>

      <p className="small" style={{ marginBottom: 10 }}>{finding.note}</p>

      {record && (
        <blockquote
          className="small"
          style={{
            borderLeft: '3px solid var(--border-strong)',
            paddingLeft: 12,
            margin: '0 0 10px',
            color: 'var(--text)',
          }}
        >
          “{record.excerpt}”
        </blockquote>
      )}

      <dl className="small cols cols-2" style={{ gap: '4px 20px' }}>
        <Pair label="Source" value={finding.sourceName} />
        <Pair label="Reliability" value={finding.reliability} />
        <Pair
          label="Published"
          value={record?.publishedAt ? when(record.publishedAt) : 'Not stated'}
        />
        <Pair label="Why this severity" value={finding.severityRationale} />
      </dl>

      <p className="small" style={{ marginTop: 8 }}>
        <a href={finding.sourceUrl} target="_blank" rel="noreferrer nofollow noopener">
          View the source
        </a>
      </p>
    </article>
  );
}

function Findings({ risk, evidence }: { risk: RiskAssessment; evidence: EvidenceRecord[] }) {
  const nothing =
    risk.findings.length === 0 && risk.needsReview.length === 0 && risk.commentary.length === 0;

  if (nothing) {
    return (
      <section className="card stack" style={{ ['--gap' as string]: '10px' }}>
        <h2 style={{ fontSize: '1.25rem' }}>Negative material</h2>
        <p className="small">
          Nothing in the results we searched asserts substantiated harm. That is a statement
          about what we could see, not a guarantee that nothing exists.
        </p>
      </section>
    );
  }

  return (
    <section className="card stack" style={{ ['--gap' as string]: '0' }}>
      <h2 style={{ fontSize: '1.25rem', marginBottom: 4 }}>Negative material</h2>

      {risk.findings.map((f) => (
        <FindingRow key={f.evidenceId} finding={f} evidence={evidence} />
      ))}

      {risk.needsReview.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3 style={{ marginBottom: 4 }}>Not counted towards the risk level</h3>
          <p className="small" style={{ marginBottom: 2 }}>
            Corrected, retracted or unresolved. Listed so you can see they exist — and so the
            correction is visible too.
          </p>
          {risk.needsReview.map((f) => (
            <FindingRow key={f.evidenceId} finding={f} evidence={evidence} />
          ))}
        </div>
      )}

      {risk.commentary.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3 style={{ marginBottom: 4 }}>Criticism and commentary</h3>
          <p className="small" style={{ marginBottom: 2 }}>
            Negative opinion is legitimate coverage. It is listed here and is never scored as
            reputational harm.
          </p>
          {risk.commentary.map((f) => (
            <FindingRow key={f.evidenceId} finding={f} evidence={evidence} />
          ))}
        </div>
      )}
    </section>
  );
}

export type DecisionHandler = (
  evidenceId: string,
  decision: 'confirmed' | 'rejected'
) => void;

function Confidence({
  confidence,
  awaiting,
  onDecision,
  pendingId,
}: {
  confidence: ConfidenceReport;
  awaiting: EvidenceRecord[];
  onDecision?: DecisionHandler;
  pendingId?: string | null;
}) {
  const low = confidence.band === 'low';

  return (
    <section className="card stack" style={{ ['--gap' as string]: '14px' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: '1.25rem' }}>How confident we are</h2>
        <span className={`pill ${low ? 'pill-warning' : 'pill-neutral'}`}>
          Identity: {confidence.band}
        </span>
      </div>

      <p className="small">{confidence.note}</p>

      <dl className="small cols cols-2" style={{ gap: '4px 20px' }}>
        <Pair label="Attributed" value={String(confidence.attributed)} />
        <Pair label="Need confirming" value={String(confidence.awaitingConfirmation)} />
        <Pair label="Not you" value={String(confidence.rejected)} />
        <Pair label="Model coverage" value={pct(confidence.evidenceCoverage)} />
      </dl>

      {awaiting.length > 0 && (
        <div style={{ paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <h3 style={{ marginBottom: 4 }}>Is this you?</h3>
          <p className="small" style={{ marginBottom: 12 }}>
            These carry your name but we are not confident they are about you. They are
            excluded from the score until you say.
          </p>

          <div className="stack" style={{ ['--gap' as string]: '10px' }}>
            {awaiting.map((e) => (
              <div
                key={e.id}
                style={{
                  padding: 14,
                  background: 'var(--surface-sunken)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span className="pill pill-neutral">{IDENTITY_WORD[e.identityStatus]}</span>
                  <span className="small">
                    Identity match {e.identityConfidence.toFixed(2)} · {e.sourceName}
                  </span>
                </div>
                <p style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{e.title}</p>
                <p className="small" style={{ marginTop: 4 }}>
                  {e.identitySignals.join(' ')}
                </p>
                <div className="row" style={{ gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ minHeight: 40 }}
                    disabled={pendingId === e.id || !onDecision}
                    onClick={() => onDecision?.(e.id, 'confirmed')}
                  >
                    {pendingId === e.id ? 'Saving…' : 'This is me'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ minHeight: 40 }}
                    disabled={pendingId === e.id || !onDecision}
                    onClick={() => onDecision?.(e.id, 'rejected')}
                  >
                    Not me
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="small" style={{ marginTop: 10 }}>
            Your answer is recorded against this scan and the score is recalculated. We keep
            the previous score too, so you can see what your decision changed.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Two views of one list, because they answer different questions.
 *
 * Reading a result and comparing results are not the same task. A card
 * gives a single source room to be understood — the excerpt in the
 * source's own words, the attribution, where it came from. A row puts
 * identity, type, source and date in fixed columns so the eye can run
 * down one of them, which is what somebody deciding what to do about a
 * set of results actually needs.
 *
 * The register is also what prints. A page of cards is several pages of
 * paper and loses the column alignment that makes one piece of evidence
 * comparable with the next, so the print stylesheet shows the table
 * whichever view is on screen.
 *
 * One list, two renderings. Nothing is filtered differently between them:
 * a view that quietly showed fewer results than the other would be the
 * worst thing on this page.
 */
function Evidence({ evidence }: { evidence: EvidenceRecord[] }) {
  const withheld = evidence.filter((e) => e.sensitivity?.withhold);
  const [view, setView] = useState<'reading' | 'register'>('reading');

  return (
    <section className="card card-flush">
      <div style={{ padding: 'var(--s-6) var(--s-6) var(--s-4)' }}>
        <div
          className="row"
          style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)', flexWrap: 'wrap' }}
        >
          <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--s-2)' }}>
            Supporting evidence
          </h2>

          <div className="viewswitch no-print" role="group" aria-label="Evidence view">
            <button
              type="button"
              onClick={() => setView('reading')}
              aria-pressed={view === 'reading'}
            >
              Reading
            </button>
            <button
              type="button"
              onClick={() => setView('register')}
              aria-pressed={view === 'register'}
            >
              Register
            </button>
          </div>
        </div>

        <p className="small">
          Everything we looked at, including what we excluded and why. Excerpts are quoted
          as the source wrote them and are never paraphrased into a claim.
        </p>

        {/**
         * Said out loud, rather than left as rows that look oddly blank.
         *
         * A reader who sees "Withheld" five times and no explanation
         * reasonably concludes something is being kept from them. The
         * opposite is true — we declined to keep a copy — and that is only
         * reassuring if it is stated.
         */}
        {withheld.length > 0 && (
          <div className="notice notice-info" style={{ marginTop: 'var(--s-4)' }}>
            <div>
              <strong>
                {withheld.length === 1
                  ? 'One result is not quoted here'
                  : `${withheld.length} results are not quoted here`}
              </strong>
              They appear to touch on personal matters — things like health, faith,
              politics or immigration — rather than professional ones. We do not store or
              repeat that material, and none of it affects your score or your risk level.
              Each one still links to its source, which is public and unchanged.
            </div>
          </div>
        )}
      </div>

      {/**
       * The reading view: one source at a time, with room to be read.
       *
       * The same records as the register, in the same order, with nothing
       * filtered out — including the withheld ones, which appear with
       * their category rather than silently disappearing from the view
       * that most people will actually look at.
       */}
      <div className={`evidence-cards${view === 'reading' ? '' : ' screen-hidden'}`}>
        {evidence.map((e) => (
          <article key={e.id} className="ev-card">
            <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap', marginBottom: 'var(--s-3)' }}>
              <span className="pill pill-neutral">{IDENTITY_WORD[e.identityStatus]}</span>
              <span className="small">
                {e.sourceName} &middot; {e.sensitivity?.withhold ? 'not quoted' : e.classification}
                {' \u00b7 '}
                seen {when(e.retrievedAt)}
              </span>
            </div>

            {e.sensitivity?.withhold ? (
              <>
                <p style={{ fontWeight: 600, fontSize: '1rem' }}>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer nofollow noopener">
                    A result we did not keep a copy of
                  </a>
                </p>
                <p className="small" style={{ marginTop: 'var(--s-2)' }}>
                  It appears to touch on {e.sensitivity.categories.map(categoryWord).join(', ').toLowerCase()} rather than
                  professional matters. The link still works; we simply hold no copy of what it
                  says, and it affects neither your score nor your risk level.
                </p>
              </>
            ) : (
              <>
                <p style={{ fontWeight: 600, fontSize: '1rem', lineHeight: 1.35 }}>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer nofollow noopener">
                    {e.title}
                  </a>
                </p>
                <p className="small" style={{ marginTop: 'var(--s-2)', fontSize: '0.9375rem' }}>
                  {e.excerpt}
                </p>
                <p className="small" style={{ marginTop: 'var(--s-3)' }}>
                  {e.classificationRationale}
                </p>
              </>
            )}

            <p className="small" style={{ marginTop: 'var(--s-3)', color: 'var(--text-2)' }}>
              Identity match {e.identityConfidence.toFixed(2)} &middot; reliability{' '}
              {e.sourceReliability}
              {e.position !== undefined ? ` \u00b7 position ${e.position}` : ''}
              {e.authorship.createdBy === 'us' ? ' \u00b7 placed by us' : ''}
            </p>
          </article>
        ))}
      </div>

      {/* The register. `print-only` in the stylesheet keeps it on paper
          even when the reading view is the one on screen. */}
      <div
        className={`scroll-x evidence-register${view === 'register' ? '' : ' screen-hidden'}`}
      >
        <table className="table table-evidence">
          <thead>
            <tr>
              {/**
               * Identity sits second, directly beside the result.
               *
               * It used to be third, behind the classification, which asked
               * the reader to take in what a result says about somebody
               * before learning whether that somebody is them. The order is
               * the reader's own question order: what is this, is it me,
               * who published it, when did we see it.
               */}
              <th>Result</th>
              <th>Is it you</th>
              <th>What it is</th>
              <th>Source</th>
              <th>Seen</th>
            </tr>
          </thead>
          <tbody>
            {evidence.map((e) => (
              <tr key={e.id}>
                <td data-label="Result" style={{ maxWidth: 320 }}>
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer nofollow noopener">
                    {e.title}
                  </a>
                  <div className="small" style={{ marginTop: 4 }}>
                    {e.excerpt}
                  </div>
                  {e.duplicateOf && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--text-2)' }}>
                      Reprint of another result — counted once.
                    </div>
                  )}
                  {e.correctionOf && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--text-2)' }}>
                      This corrects an earlier result.
                    </div>
                  )}
                </td>
                {/**
                 * The number says what it measures.
                 *
                 * It read "Confirmed · 0.98" and nothing on the page said
                 * what 0.98 was. A reader could take it for source quality,
                 * relevance, or this result's contribution to the score. It
                 * is none of those: it is how sure we are the result is
                 * about them, and that is now the words beside it.
                 */}
                <td data-label="Is it you" style={{ minWidth: 130 }}>
                  <span className="pill pill-neutral">{IDENTITY_WORD[e.identityStatus]}</span>
                  <div className="small" style={{ marginTop: 6 }}>
                    Identity match {e.identityConfidence.toFixed(2)}
                  </div>
                  {e.reviewStatus === 'needs_human_review' && (
                    <div className="small" style={{ marginTop: 6 }}>Flagged for review</div>
                  )}
                </td>
                <td data-label="What it is" style={{ minWidth: 150 }}>
                  {e.sensitivity?.withhold ? (
                    <>
                      <span className="pill pill-info">Not quoted</span>
                      {/**
                       * The category, not the content. "Health" says why the
                       * excerpt is missing without restating the thing the
                       * excerpt said.
                       */}
                      <div className="small" style={{ marginTop: 'var(--s-2)' }}>
                        {e.sensitivity.categories.map(categoryWord).join(', ')}
                      </div>
                      <div className="small" style={{ marginTop: 'var(--s-2)' }}>
                        Excluded from your score and your risk level.
                      </div>
                    </>
                  ) : (
                    <>
                  <span className="pill pill-neutral">{e.classification}</span>
                  {e.findingStatus && (
                    <div className="small" style={{ marginTop: 6 }}>
                      {STATUS_WORD[e.findingStatus]}
                    </div>
                  )}
                  <div className="small" style={{ marginTop: 6 }}>
                    {e.classificationRationale}
                  </div>
                    </>
                  )}
                </td>
                <td data-label="Source" style={{ minWidth: 130 }}>
                  <div>{e.sourceName}</div>

                  {/**
                   * Said on the customer's own report, not only in ours.
                   *
                   * If we placed something, the person paying for the work
                   * is the first person entitled to know which results are
                   * ours — otherwise the before-and-after is a conjuring
                   * trick. It also explains why a result that looks like
                   * coverage is not counted as coverage, which is
                   * otherwise the most confusing number on the page.
                   */}
                  {e.authorship.createdBy === 'us' && (
                    <div className="small" style={{ marginTop: 4, color: 'var(--warning)' }}>
                      Placed by us
                      {e.authorship.editorialIndependence === 'verified'
                        ? ' — accepted by this publication'
                        : ' — not counted as independent coverage'}
                    </div>
                  )}
                  <div className="small" style={{ marginTop: 4 }}>
                    Reliability: {e.sourceReliability}
                  </div>
                  {e.position !== undefined && (
                    <div className="small">Position {e.position}</div>
                  )}
                </td>
                <td data-label="Seen" className="small" style={{ minWidth: 110 }}>
                  <div>{when(e.retrievedAt)}</div>
                  <div style={{ marginTop: 4 }}>
                    {e.publishedAt ? `Published ${when(e.publishedAt)}` : 'No date given'}
                  </div>
                  <div style={{ marginTop: 4 }}>{e.provenance.replace('_', ' ')}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Recommendations({ items }: { items: Recommendation[] }) {
  if (items.length === 0) return null;

  const LABEL = { now: 'Do now', soon: 'Do soon', later: 'Later' } as const;
  const PILL = { now: 'pill-danger', soon: 'pill-warning', later: 'pill-neutral' } as const;

  /**
   * Who decides, said in words rather than carried by a colour.
   *
   * The distinction a reader actually wants is not how important something
   * is — the order already says that — but whether they can start it
   * today. "Waits on someone else" is the one that changes a plan.
   */
  const CONTROL = {
    yours: 'Yours to do',
    shared: 'Yours to ask for',
    not_yours: 'Waits on someone else',
  } as const;

  return (
    <section className="card stack" style={{ ['--gap' as string]: '0' }}>
      <h2 className="mark" style={{ fontSize: '1.25rem', marginBottom: 4 }}>
        What to do next
      </h2>
      <p className="small" style={{ marginBottom: 6 }}>
        Ordered by what would change most, and within that by what you can start without
        anyone&rsquo;s permission. Each one names the evidence it came from.
      </p>

      {items.map((r) => (
        <div key={r.id} style={{ padding: '16px 0', borderTop: '1px solid var(--border)' }}>
          <div className="row" style={{ gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span className={`pill ${PILL[r.priority]}`}>{LABEL[r.priority]}</span>
            <span className="pill pill-neutral">{CONTROL[r.control]}</span>
            {r.evidenceIds.length > 0 && (
              <span className="pill pill-neutral">
                {r.evidenceIds.length} piece{r.evidenceIds.length === 1 ? '' : 's'} of evidence
              </span>
            )}
          </div>
          <h3 style={{ marginBottom: 4 }}>{r.title}</h3>
          <p className="small">{r.why}</p>

          {/**
           * The answer to "fine, but how".
           *
           * Set apart from `why` because they are different kinds of
           * sentence: `why` is about this customer's results, and this is
           * general practice that reads the same for everybody. Running
           * them together would make the second look like a finding about
           * the reader.
           */}
          {r.how && (
            <p
              className="small"
              style={{
                marginTop: 'var(--s-3)',
                paddingLeft: 'var(--s-4)',
                borderLeft: '2px solid var(--border)',
              }}
            >
              {r.how}
            </p>
          )}

          {r.caveat && (
            <p className="small" style={{ marginTop: 6, color: 'var(--warning)' }}>
              {r.caveat}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function Limitations({ scan }: { scan: Scan }) {
  return (
    <section className="notice notice-info">
      <div>
        <strong>What this report is and is not</strong>
        <ul className="small stack" style={{ ['--gap' as string]: '6px', paddingLeft: 18, marginTop: 8 }}>
          <li>
            A snapshot of the top {scan.window} results for {scan.queries.length} queries on{' '}
            {when(scan.observedAt)} — not an inventory of everything about you.
          </li>
          <li>
            A measure of observable online presence, not of character, honesty or competence.
          </li>
          <li>
            Scoring is provisional and has not been empirically validated. Treat the number
            as a structured reading, not a measurement.
          </li>
          <li>
            We do not promise rankings, removals, suppression of negative results or a higher
            score.
          </li>
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- the page */

export interface ScoreHistoryEntry {
  score: number | null;
  coverage: number;
  methodologyVersion: string;
  computedAt: string;
  reason: string;
}

/**
 * Snapshot history.
 *
 * Shown only once a score has actually changed. The point is not a chart —
 * it is being able to answer "why is this different from yesterday" without
 * taking our word for it.
 */
function History({ entries }: { entries: ScoreHistoryEntry[] }) {
  if (entries.length < 2) return null;

  return (
    <section className="card stack" style={{ ['--gap' as string]: '10px' }}>
      <h2 style={{ fontSize: '1.25rem' }}>How this score has changed</h2>
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Score</th>
              <th>Coverage</th>
              <th>Why it was recalculated</th>
              <th>Methodology</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((h, i) => (
              <tr key={`${h.computedAt}-${i}`}>
                <td style={{ fontWeight: 600 }}>{h.score ?? 'Not scored'}</td>
                <td>{pct(h.coverage)}</td>
                <td>{h.reason}</td>
                <td className="small mono">{h.methodologyVersion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        Earlier scores are kept as written. A recalculation adds a row; it never edits one.
      </p>
    </section>
  );
}

export function Report({
  report,
  name,
  onDecision,
  pendingId,
  history = [],
}: {
  report: CompleteReport;
  name: string;
  onDecision?: DecisionHandler;
  pendingId?: string | null;
  history?: ScoreHistoryEntry[];
}) {
  return (
    <div className="stack" style={{ ['--gap' as string]: '24px' }}>
      {report.scan.isFixture && <FixtureBanner />}

      <Cover
        name={name}
        scan={report.scan}
        presence={report.presence}
        confidence={report.confidence}
      />

      <Headline presence={report.presence} />

      <BriefingFindings findings={report.findings} />

      <div className="cols cols-score">
        <PresenceCard presence={report.presence} />
        <RiskCard risk={report.risk} />
      </div>

      <AuditDetails scan={report.scan} />

      <Findings risk={report.risk} evidence={report.evidence} />
      <Dimensions presence={report.presence} />
      <Confidence
        confidence={report.confidence}
        awaiting={report.awaitingConfirmation}
        onDecision={onDecision}
        pendingId={pendingId}
      />
      <History entries={history} />
      <Recommendations items={report.recommendations} />
      <Evidence evidence={report.evidence} />
      <Limitations scan={report.scan} />
    </div>
  );
}
