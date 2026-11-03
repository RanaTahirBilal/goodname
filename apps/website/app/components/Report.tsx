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
  ConfidenceReport,
  EvidenceRecord,
  FindingStatus,
  PresenceScore,
  Recommendation,
  RiskAssessment,
  RiskFinding,
  RiskLevel,
} from '@rep/domain';

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

const IDENTITY_WORD: Record<string, string> = {
  confirmed: 'Confirmed',
  probable: 'Probable',
  uncertain: 'Uncertain',
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

function ScanSummary({ scan }: { scan: Scan }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <p className="eyebrow" style={{ marginBottom: 12 }}>What we looked at</p>
      <div className="cols cols-2" style={{ gap: 16 }}>
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
    </div>
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
  if (presence.status === 'insufficient_evidence') {
    return (
      <div className="card stack" style={{ ['--gap' as string]: '12px' }}>
        <p className="eyebrow">Online presence</p>
        <h2 style={{ fontSize: '1.4rem' }}>Not enough evidence to score</h2>
        <p className="small">
          We could evaluate {pct(presence.coverage)} of the model, below the 55% we require.
          Rather than publish a number built on too little, here is what would change that:
        </p>
        <ul className="small stack" style={{ ['--gap' as string]: '6px', paddingLeft: 18 }}>
          {presence.whatWouldHelp.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 'var(--s-3)' }}>Online presence</p>

      {/* The one big thing on the page. Everything else is medium or small. */}
      <div className="row" style={{ alignItems: 'baseline', gap: 'var(--s-3)' }}>
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
      <p className="eyebrow">Reputation risk</p>

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

      {presence.dimensions.map((d) => (
        <div key={d.code}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{d.label}</span>
            <span className="small" style={{ color: 'var(--text)', fontWeight: 600 }}>
              {d.value === null ? 'Not applicable' : Math.round(d.value * 100)}
            </span>
          </div>

          {d.value === null ? (
            <div
              className="meter"
              style={{ background: 'repeating-linear-gradient(90deg, var(--surface-sunken) 0 6px, var(--surface) 6px 12px)' }}
              aria-hidden
            />
          ) : (
            <div className="meter">
              <span style={{ width: `${d.value * 100}%` }} />
            </div>
          )}

          <p className="small" style={{ marginTop: 6 }}>{d.explanation}</p>
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
                  <span className="pill pill-neutral">
                    {IDENTITY_WORD[e.identityStatus]} · {e.identityConfidence.toFixed(2)}
                  </span>
                  <span className="small">{e.sourceName}</span>
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

function Evidence({ evidence }: { evidence: EvidenceRecord[] }) {
  const withheld = evidence.filter((e) => e.sensitivity?.withhold);

  return (
    <section className="card card-flush">
      <div style={{ padding: 'var(--s-6) var(--s-6) var(--s-4)' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--s-2)' }}>Evidence</h2>
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

      <div className="scroll-x">
        <table className="table table-evidence">
          <thead>
            <tr>
              <th>Result</th>
              <th>What it is</th>
              <th>Is it you</th>
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
                <td data-label="Is it you" style={{ minWidth: 130 }}>
                  <span className="pill pill-neutral">
                    {IDENTITY_WORD[e.identityStatus]} · {e.identityConfidence.toFixed(2)}
                  </span>
                  {e.reviewStatus === 'needs_human_review' && (
                    <div className="small" style={{ marginTop: 6 }}>Flagged for review</div>
                  )}
                </td>
                <td data-label="Source" style={{ minWidth: 130 }}>
                  <div>{e.sourceName}</div>
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

  return (
    <section className="card stack" style={{ ['--gap' as string]: '0' }}>
      <h2 style={{ fontSize: '1.25rem', marginBottom: 4 }}>What to do next</h2>
      <p className="small" style={{ marginBottom: 6 }}>
        Ordered by what would change most. Each one names the evidence it came from.
      </p>

      {items.map((r) => (
        <div key={r.id} style={{ padding: '16px 0', borderTop: '1px solid var(--border)' }}>
          <div className="row" style={{ gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span className={`pill ${PILL[r.priority]}`}>{LABEL[r.priority]}</span>
            {r.evidenceIds.length > 0 && (
              <span className="pill pill-neutral">
                {r.evidenceIds.length} piece{r.evidenceIds.length === 1 ? '' : 's'} of evidence
              </span>
            )}
          </div>
          <h3 style={{ marginBottom: 4 }}>{r.title}</h3>
          <p className="small">{r.why}</p>
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

      <div
        className="row"
        style={{
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 'var(--s-4)',
          // `.row` does not wrap. A 48px-tall button beside a display-size
          // name is wider than a phone, and an unwrapped row turns that into
          // sideways scroll on the one page nobody should have to scroll.
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p className="eyebrow">Audit report</p>
          <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.5rem)' }}>{name}</h1>
        </div>

        {/**
         * Printing is the save button.
         *
         * Every browser's print dialogue offers "Save as PDF", so this is a
         * document export without a PDF library, a server round trip or a
         * second rendering of the report that could drift from the first.
         * The print stylesheet does the work; `no-print` keeps the control
         * itself off the paper.
         */}
        <SaveButton />
      </div>

      <ScanSummary scan={report.scan} />

      <div className="cols cols-score">
        <PresenceCard presence={report.presence} />
        <RiskCard risk={report.risk} />
      </div>

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
