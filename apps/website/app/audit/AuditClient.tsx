'use client';

/**
 * The audit flow: request → progress → report.
 *
 * The progress view deliberately shows only what is actually known. We know
 * the provider and the queries before the request goes out, so those are
 * shown; we do not know how far through classification the server is, so
 * there is no staged progress bar pretending otherwise. A fabricated
 * five-step animation would be the first dishonest thing in the product.
 */
import { useState } from 'react';
import { Report, type CompleteReport, type ScoreHistoryEntry } from '../components/Report';

const SELF_AUDIT_ATTESTATION =
  'I confirm this audit is about me, and that I am not using it to research another person.';

type Issue = { field: string; message: string };

type ApiResponse =
  | (CompleteReport & { scanId?: string; presenceHistory?: ScoreHistoryEntry[] })
  | { status: 'queued'; scanId: string; jobId: string }
  | { status: 'invalid_input'; issues: Issue[] }
  | { status: 'not_permitted'; reason: string; message: string }
  | {
      status: 'search_failed';
      provider: string;
      reason: 'provider_error' | 'rate_limited';
      message: string;
      retryAfterSeconds?: number;
    };

const PROFESSIONS = [
  ['attorney', 'Attorney'],
  ['physician', 'Physician'],
  ['founder', 'Founder'],
  ['executive', 'Executive'],
  ['other', 'Other'],
] as const;

/**
 * Fixture scenarios, exposed because there is no live provider. Labelling the
 * selector honestly is better than a form that silently returns the same
 * invented person every time.
 */
const SCENARIOS = [
  ['strong', 'Well-established presence, nothing negative'],
  ['official_finding', 'An official disciplinary record'],
  ['allegation', 'An unsettled accusation'],
  ['syndicated', 'One wire story reprinted by three outlets'],
  ['corroborated', 'Two outlets reporting independently'],
  ['retracted', 'A story the source later withdrew'],
  ['employer_collision', 'News about the firm, not the person'],
  ['ambiguous', 'A different person with the same name'],
  ['sensitive', 'Personal matters mixed in with professional ones'],
  ['sparse', 'Almost nothing findable'],
  ['empty', 'The search returns no results'],
  ['provider_error', 'The search provider fails'],
  ['rate_limited', 'The search provider throttles us'],
] as const;

const DEFAULTS = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  region: 'Illinois',
  credentials: 'JD',
  websiteUrl: 'https://adoni-law.example',
};

export default function AuditClient() {
  const [form, setForm] = useState(DEFAULTS);
  const [scenario, setScenario] = useState<string>('strong');
  const [attested, setAttested] = useState(false);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    queries?: string[];
    provider?: string;
    job?: { attempts: number; maxAttempts: number } | null;
  } | null>(null);

  const set = (key: keyof typeof DEFAULTS) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;

  /**
   * Submits, then polls until the job finishes.
   *
   * The audit no longer runs inside the request — the cheapest search
   * provider averages five minutes — so the response is a scan id and the
   * work happens behind it. Polling a status endpoint is the simplest thing
   * that survives a page refresh, which a websocket would not.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run();
  }

  /**
   * The audit itself, separated from the form's submit.
   *
   * The failure screen needs to start one too. It used to offer only
   * "Back", which returns to the form the customer has already filled in
   * correctly and asks them to press the same button again — a provider
   * that did not answer is not their mistake to correct, and making them
   * retrace the step reads as though it were.
   */
  async function run() {
    setState('running');
    setIssues([]);
    setResponse(null);
    setProgress(null);

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, attested, scenario }),
      });
      const data: ApiResponse = await res.json();

      if (data.status === 'invalid_input') {
        setIssues(data.issues);
        setState('idle');
        return;
      }

      if (data.status !== 'queued') {
        setResponse(data);
        setState('error');
        return;
      }

      await waitForReport(data.scanId);
    } catch {
      setResponse({
        status: 'search_failed',
        provider: 'network',
        reason: 'provider_error',
        message: 'We could not reach the audit service.',
      });
      setState('error');
    }
  }

  /**
   * Polls until the scan is ready or the job gives up.
   *
   * Bounded rather than open-ended: a spinner with no end is worse than an
   * honest "this is taking longer than expected", because the first one
   * never tells anybody to do something about it.
   */
  async function waitForReport(scanId: string) {
    const startedAt = Date.now();
    const limitMs = 2 * 60 * 1000;

    for (;;) {
      const res = await fetch(`/api/scan/${scanId}/status`);
      const status: {
        state: 'working' | 'ready' | 'failed';
        queries?: string[];
        provider?: string;
        job?: { attempts: number; maxAttempts: number; lastError?: string } | null;
        failure?: { reason: string; message: string };
      } = await res.json();

      setProgress(status);

      if (status.state === 'ready') {
        const report = await fetch(`/api/scan/${scanId}`);
        const data: ApiResponse = await report.json();
        setResponse(data);
        setState(data.status === 'complete' ? 'done' : 'error');
        return;
      }

      if (status.state === 'failed') {
        setResponse({
          status: 'search_failed',
          provider: status.provider ?? 'unknown',
          reason: 'provider_error',
          /**
           * Never `job.lastError`. That is an exception string — it is in
           * the status payload for whoever is debugging, and putting it in
           * front of a customer tells them nothing they can act on while
           * sounding like the product broke in a way they caused.
           */
          message:
            status.failure?.message ??
            'The search did not finish. Nothing partial was saved, so running it again starts cleanly.',
        });
        setState('error');
        return;
      }

      if (Date.now() - startedAt > limitMs) {
        setResponse({
          status: 'search_failed',
          provider: status.provider ?? 'unknown',
          reason: 'provider_error',
          message:
            'This is taking much longer than it should. The scan is saved, so nothing is lost — try opening it again in a few minutes.',
        });
        setState('error');
        return;
      }

      await new Promise((r) => setTimeout(r, 600));
    }
  }

  /**
   * Records the customer's answer, then reloads the report from the server
   * rather than patching it locally. The score is recomputed server side, and
   * a client-side guess at the new number would be a second implementation of
   * the scoring rules waiting to disagree with the first.
   */
  async function decide(evidenceId: string, decision: 'confirmed' | 'rejected') {
    const scanId = response && 'scanId' in response ? response.scanId : undefined;
    if (!scanId) return;

    setPendingId(evidenceId);
    try {
      await fetch(`/api/scan/${scanId}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidenceId, decision }),
      });

      const res = await fetch(`/api/scan/${scanId}`);
      const fresh: ApiResponse = await res.json();
      if (fresh.status === 'complete') setResponse(fresh);
    } finally {
      setPendingId(null);
    }
  }

  if (state === 'done' && response?.status === 'complete') {
    return (
      <div className="wrap" style={{ padding: '40px 24px 64px' }}>
        <Report
          report={response}
          name={form.fullName}
          onDecision={decide}
          pendingId={pendingId}
          history={('presenceHistory' in response && response.presenceHistory) || []}
        />
        <p style={{ marginTop: 32 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setState('idle');
              setResponse(null);
            }}
          >
            Run another audit
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="wrap-narrow" style={{ padding: '40px 24px 64px' }}>
      {state === 'running' && (
        <Running
          provider={progress?.provider ?? 'fixture'}
          queries={progress?.queries ?? queriesFor(form)}
          attempt={progress?.job?.attempts ?? 0}
        />
      )}

      {state === 'error' && response && (
        <Failure
          response={response}
          onBack={() => setState('idle')}
          onRetry={() => void run()}
        />
      )}

      {state === 'idle' && (
        <form className="stack" style={{ ['--gap' as string]: '24px' }} onSubmit={submit}>
          <div>
            <p className="eyebrow mark">Free audit</p>
            <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.4rem)' }}>
              Audit your own presence
            </h1>
            <p className="lede" style={{ marginTop: 10 }}>
              The more you tell us, the better we can tell you apart from other people with
              your name.
            </p>
          </div>

          <div className="card stack" style={{ ['--gap' as string]: '18px' }}>
            <Field
              label="Full name"
              hint="The name you publish under."
              value={form.fullName}
              onChange={set('fullName')}
              error={issueFor('fullName')}
              required
            />

            <div className="field">
              <label className="label" htmlFor="profession">Profession</label>
              <select
                id="profession"
                className="select"
                value={form.profession}
                onChange={set('profession')}
              >
                {PROFESSIONS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
              <span className="hint">Tells us which professional profiles to look for.</span>
              {issueFor('profession') && <span className="error">{issueFor('profession')}</span>}
            </div>

            <Field label="Employer" hint="Optional." value={form.employer} onChange={set('employer')} />

            <div className="cols cols-2" style={{ gap: 18 }}>
              <Field label="City" hint="Optional." value={form.city} onChange={set('city')} />
              <Field
                label="State or region"
                hint="Helps with official records."
                value={form.region}
                onChange={set('region')}
              />
            </div>

            <Field
              label="Credentials"
              hint="Comma separated — JD, MD, bar admissions."
              value={form.credentials}
              onChange={set('credentials')}
            />

            <Field
              label="Your website"
              hint="So we can tell which results you control, and audit the site."
              value={form.websiteUrl}
              onChange={set('websiteUrl')}
              error={issueFor('websiteUrl')}
              type="url"
            />
          </div>

          <div className="card stack" style={{ ['--gap' as string]: '14px' }}>
            <div className="field">
              <label className="label" htmlFor="scenario">Demonstration scenario</label>
              <select
                id="scenario"
                className="select"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                {SCENARIOS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
              <span className="hint">
                No live search provider is connected yet, so audits run against fixture data.
                This chooses which situation to demonstrate.
              </span>
            </div>
          </div>

          <div className="checkbox-row">
            <input
              id="attested"
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            <label htmlFor="attested" style={{ fontSize: '0.9375rem' }}>
              {SELF_AUDIT_ATTESTATION}
              <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                This product is for auditing your own presence. We rate-limit by how many
                different names an account looks up, not just how many audits it runs.
              </span>
              {issueFor('attested') && (
                <span className="error" style={{ display: 'block', marginTop: 6 }}>
                  {issueFor('attested')}
                </span>
              )}
            </label>
          </div>

          <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
            Run the audit
          </button>
        </form>
      )}
    </div>
  );
}

function queriesFor(f: typeof DEFAULTS): string[] {
  const terms = [f.fullName];
  if (f.employer) terms.push(`${f.fullName} ${f.employer}`);
  if (f.city) terms.push(`${f.fullName} ${f.city}`);
  return terms;
}

function Field({
  label,
  hint,
  value,
  onChange,
  error,
  type = 'text',
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  error?: string;
  type?: string;
  required?: boolean;
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label} {!required && <span className="hint">(optional)</span>}
      </label>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {hint && <span className="hint">{hint}</span>}
      {error && (
        <span className="error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

function Running({
  provider,
  queries,
  attempt,
}: {
  provider: string;
  queries: string[];
  attempt: number;
}) {
  return (
    <div className="card stack" style={{ ['--gap' as string]: '16px' }} role="status" aria-live="polite">
      <h1 style={{ fontSize: '1.5rem' }} className="pulse">
        Searching…
      </h1>

      <p className="small">
        Running {queries.length} quer{queries.length === 1 ? 'y' : 'ies'} against the{' '}
        <strong>{provider}</strong> provider, then matching results to you, classifying what
        they are, and scoring.
      </p>

      <ul className="small mono stack" style={{ ['--gap' as string]: '4px', listStyle: 'none' }}>
        {queries.map((q) => (
          <li key={q}>“{q}”</li>
        ))}
      </ul>

      {attempt > 1 && (
        <p className="small" style={{ color: 'var(--warning)' }}>
          The provider failed once and we are retrying. Attempt {attempt}.
        </p>
      )}

      <p className="small">
        We show the provider, the queries and the attempt because those are known. We do not
        show a step-by-step progress bar, because the real progress is not visible from here
        and a fake one would be the first thing in this product that lied to you.
      </p>
    </div>
  );
}

function Failure({
  response,
  onBack,
  onRetry,
}: {
  response: ApiResponse;
  onBack: () => void;
  onRetry: () => void;
}) {
  if (response.status === 'not_permitted') {
    const enumeration = response.reason === 'enumeration_suspected';

    return (
      <div className="stack" style={{ ['--gap' as string]: '20px' }}>
        <div>
          <p className="eyebrow">Audit not run</p>
          <h1 style={{ fontSize: 'clamp(1.6rem, 1.3rem + 1.2vw, 2.1rem)' }}>
            We stopped this one on purpose
          </h1>
        </div>

        <div className="notice notice-warning">
          <div>
            <strong>{response.message}</strong>
            This product is for auditing your own presence. We limit how many{' '}
            <em>different</em> names one account can look up — re-running your own is never
            restricted. It is the main thing stopping this being a people-search engine.
          </div>
        </div>

        {!enumeration && (
          <div className="card stack" style={{ ['--gap' as string]: '12px' }}>
            <h2 style={{ fontSize: '1.125rem' }}>If the second name is also you</h2>
            <p className="small">
              People change names, publish under initials, or practise under a maiden name.
              Verifying an email address is how you tell us a second name is still you.
            </p>
            <a href="/signin" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
              Verify my email
            </a>
          </div>
        )}

        <p className="small">
          Recorded as <span className="mono">{response.reason}</span>. Nothing was searched, so
          this name does not appear in any log of ours.
        </p>

        <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  if (response.status === 'search_failed') {
    const waiting = response.retryAfterSeconds
      ? Math.round(response.retryAfterSeconds / 60)
      : 0;

    /**
     * An interruption, not a verdict.
     *
     * This screen used to open "The search did not complete", spend its
     * next sentence on how many attempts were made, and end at a lone
     * "Back" button. Everything on it was true and the whole of it read as
     * a broken product: a technical account of a failure, with no way
     * forward. The customer did nothing wrong and has nothing to correct,
     * so the first thing on the page is now the action that fixes it.
     *
     * The distinction the copy underneath protects is the one that
     * matters: a failed search must never look like a search that found
     * nothing.
     */
    return (
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
        <div>
          <p className="eyebrow mark">Not finished</p>
          <h1 style={{ fontSize: 'clamp(1.6rem, 1.3rem + 1.2vw, 2.1rem)' }}>
            We could not complete your check
          </h1>
          <p className="lede" style={{ marginTop: 'var(--s-3)' }}>
            {waiting
              ? `The search provider is not answering. Worth trying again in about ${waiting} minutes.`
              : 'The search provider did not answer. Nothing was scored, so running it again starts cleanly.'}
          </p>
        </div>

        <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Edit details
          </button>
        </div>

        <p className="small">
          We are not showing you a report. An empty one would suggest we looked and found
          nothing about you, which is a very different thing from not having looked.
        </p>

        {/* The diagnostic, kept and demoted: an operator's detail, not the reader's. */}
        <details className="card disclosure">
          <summary className="eyebrow">What went wrong</summary>
          <p className="small" style={{ marginTop: 'var(--s-4)' }}>
            {response.message}
          </p>
          <p className="small" style={{ marginTop: 'var(--s-3)' }}>
            Recorded as <span className="mono">{response.reason}</span>.
          </p>
        </details>
      </div>
    );
  }

  return null;
}
