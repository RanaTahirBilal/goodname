'use client';

/**
 * The reviewer's screen.
 *
 * One record at a time, with the evidence quoted as the source wrote it and
 * the reason it was flagged stated in words. A list of fifty rows invites
 * clicking through them; one record at a time is slower on purpose, because
 * the output of this screen is a sentence about a real person.
 */
import { useEffect, useState } from 'react';
import StaffSignIn from './StaffSignIn';

type Outcome =
  | 'uphold'
  | 'downgrade_to_allegation'
  | 'reject_not_this_person'
  | 'reject_not_harm';

interface QueueItem {
  evidenceId: string;
  scanId: string;
  title: string;
  excerpt: string;
  sourceName: string;
  sourceUrl: string;
  classification: string;
  findingStatus?: string;
  severity?: number;
  severityRationale?: string;
  identityConfidence: number;
  identityStatus: string;
  sourceReliability: string;
  retrievedAt: string;
  flaggedBecause: string;
}

const OUTCOMES: { value: Outcome; label: string; help: string }[] = [
  {
    value: 'uphold',
    label: 'Uphold',
    help: 'The classification is right. It stands as written.',
  },
  {
    value: 'downgrade_to_allegation',
    label: 'Downgrade to allegation',
    help: 'About the right person, but not established. Reported, not proven.',
  },
  {
    value: 'reject_not_this_person',
    label: 'Not this person',
    help: 'The identity match is wrong. It leaves their score entirely.',
  },
  {
    value: 'reject_not_harm',
    label: 'Not harm',
    help: 'Right person, but this is commentary rather than a harm claim.',
  },
];

interface Me {
  email: string;
  role: string;
}

export default function ReviewClient() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [pending, setPending] = useState(0);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome>('uphold');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Who we are comes first. The queue endpoint answers 404 both when nobody
   * is signed in and when the caller is not staff, so it cannot tell us which
   * screen to show — asking separately is what lets a signed-out reviewer see
   * a sign-in form instead of an error.
   */
  async function load() {
    const who = await fetch('/api/staff/me');
    const whoData = who.ok ? await who.json() : { staff: null };

    if (!whoData.staff) {
      setMe(null);
      setItems([]);
      return;
    }

    setMe(whoData.staff);

    const res = await fetch('/api/review/queue');
    if (!res.ok) {
      setItems([]);
      return;
    }
    const data = await res.json();
    setItems(data.items);
    setPending(data.pending);
  }

  async function signOut() {
    await fetch('/api/staff/signout', { method: 'POST' });
    setMe(null);
    setItems([]);
  }

  useEffect(() => {
    void load();
  }, []);

  const current = items?.[0];

  async function decide() {
    if (!current) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/review/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scanId: current.scanId,
          evidenceId: current.evidenceId,
          outcome,
          rationale,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'That did not save.');
        return;
      }

      setRationale('');
      setOutcome('uphold');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (me === null) {
    return (
      <StaffSignIn
        onSignedIn={() => {
          setItems(null);
          void load();
        }}
      />
    );
  }

  if (me === undefined || items === null) {
    return (
      <div className="wrap-narrow" style={{ padding: 'var(--s-12) var(--s-6)' }}>
        <p className="pulse">Loading the queue…</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="wrap-narrow" style={{ padding: 'var(--s-8) var(--s-6) var(--s-16)' }}>
        <Who email={me.email} onSignOut={signOut} />
        <p className="eyebrow">Review queue</p>
        <h1>Nothing is waiting</h1>
        <p className="lede" style={{ marginTop: 'var(--s-4)' }}>
          Every flagged record has been looked at.
        </p>
      </div>
    );
  }

  return (
    <div className="wrap-narrow" style={{ padding: 'var(--s-8) var(--s-6) var(--s-16)' }}>
      <Who email={me.email} onSignOut={signOut} />

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--s-6)' }}>
        <p className="eyebrow">Review queue</p>
        <span className="pill pill-neutral">{pending} waiting</span>
      </div>

      <div className="notice notice-warning" style={{ marginBottom: 'var(--s-6)' }}>
        <div>
          <strong>Why this is here</strong>
          {current.flaggedBecause}
        </div>
      </div>

      <h1 style={{ fontSize: 'clamp(1.5rem, 1.2rem + 1.2vw, 2rem)' }}>{current.title}</h1>

      <blockquote
        style={{
          margin: 'var(--s-6) 0',
          paddingLeft: 'var(--s-4)',
          borderLeft: '3px solid var(--border-strong)',
          fontSize: '1.0625rem',
        }}
      >
        “{current.excerpt}”
      </blockquote>

      <dl className="small cols cols-2" style={{ gap: 'var(--s-1) var(--s-6)', marginBottom: 'var(--s-6)' }}>
        <Pair label="Source" value={current.sourceName} />
        <Pair label="Reliability" value={current.sourceReliability} />
        <Pair label="Classified as" value={current.classification} />
        <Pair label="Finding status" value={current.findingStatus ?? 'none'} />
        <Pair
          label="Identity"
          value={`${current.identityStatus} · ${current.identityConfidence.toFixed(2)}`}
        />
        <Pair label="Severity" value={current.severity ? `${current.severity} of 5` : 'none'} />
      </dl>

      {current.severityRationale && (
        <p className="small" style={{ marginBottom: 'var(--s-6)' }}>
          Classifier said: {current.severityRationale}
        </p>
      )}

      <p className="small" style={{ marginBottom: 'var(--s-8)' }}>
        <a href={current.sourceUrl} target="_blank" rel="noreferrer nofollow noopener">
          Open the source
        </a>{' '}
        — read it before deciding.
      </p>

      <hr className="divider" style={{ marginBottom: 'var(--s-6)' }} />

      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <h2 style={{ fontSize: '1.25rem' }}>Your decision</h2>

        {OUTCOMES.map((o) => (
          <label
            key={o.value}
            className="row"
            style={{
              alignItems: 'flex-start',
              gap: 'var(--s-3)',
              padding: 'var(--s-3)',
              background: outcome === o.value ? 'var(--surface-sunken)' : 'transparent',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="outcome"
              checked={outcome === o.value}
              onChange={() => setOutcome(o.value)}
              style={{ marginTop: 4, width: 18, height: 18 }}
            />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>{o.label}</span>
              <span className="small">{o.help}</span>
            </span>
          </label>
        ))}

        <div className="field">
          <label className="label" htmlFor="rationale">
            Why
          </label>
          <textarea
            id="rationale"
            className="input"
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            style={{ minHeight: 88, resize: 'vertical' }}
          />
          <span className="hint">
            Required. This changes what a customer is told about themselves, so somebody has
            to be able to check your reasoning later.
          </span>
          {error && <span className="error">{error}</span>}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ alignSelf: 'flex-start' }}
          disabled={busy || rationale.trim().length < 10}
          onClick={decide}
        >
          {busy ? 'Saving…' : 'Record decision'}
        </button>
      </div>
    </div>
  );
}

/**
 * Who is deciding, on every screen that can record a decision.
 *
 * Not decoration: a reviewer who has forgotten whose session they are in is
 * about to attribute a judgement to somebody else.
 */
function Who({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div
      className="row small"
      style={{
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--s-3)',
        paddingBottom: 'var(--s-3)',
        marginBottom: 'var(--s-6)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span>
        Signed in as <strong>{email}</strong>. Everything you open is logged against this
        address.
      </span>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ flexShrink: 0 }}
        onClick={onSignOut}
      >
        Sign out
      </button>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', gap: 'var(--s-2)' }}>
      <dt style={{ minWidth: 104, color: 'var(--text-2)' }}>{label}</dt>
      <dd className="grow" style={{ color: 'var(--text)' }}>
        {value}
      </dd>
    </div>
  );
}
