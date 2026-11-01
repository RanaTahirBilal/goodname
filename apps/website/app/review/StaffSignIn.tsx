'use client';

/**
 * Staff sign-in for the review queue.
 *
 * Says what the queue is and what using it means, before anyone signs in.
 * A reviewer is about to read evidence belonging to people who did not
 * consent to them specifically, under their own name, with every record they
 * open written down. That is worth one paragraph on the way in rather than a
 * policy document nobody reads.
 *
 * There is no "create an account" link, because there is no such thing here.
 */
import { useState } from 'react';

interface Props {
  onSignedIn: () => void;
}

export default function StaffSignIn({ onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/staff/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? 'That did not work.');
        return;
      }

      setNotice(data.message);
      setStage('code');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/staff/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? 'That did not work.');
        return;
      }

      onSignedIn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap-narrow" style={{ padding: 'var(--s-12) var(--s-6)' }}>
      <p className="eyebrow">Internal</p>
      <h1>Review queue</h1>

      <p className="lede" style={{ marginTop: 'var(--s-4)' }}>
        This queue holds evidence about customers, flagged because it could damage them or
        because we are not certain it is them.
      </p>

      <div className="notice notice-warning" style={{ margin: 'var(--s-6) 0' }}>
        <div>
          <strong>Everything you open is recorded</strong>
          Every record you read is logged against your name, not only the ones you decide on.
          Decisions need a written reason, because they change what a customer is told about
          themselves.
        </div>
      </div>

      {stage === 'email' ? (
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
          <div className="field">
            <label className="label" htmlFor="staff-email">
              Your work email
            </label>
            <input
              id="staff-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email) void request();
              }}
            />
            <span className="hint">
              Reviewer accounts are created on the server. There is no sign-up.
            </span>
            {error && <span className="error">{error}</span>}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy || !email}
            onClick={request}
          >
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
          {notice && <p className="small">{notice}</p>}

          <div className="field">
            <label className="label" htmlFor="staff-code">
              Six-digit code
            </label>
            <input
              id="staff-code"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) void verify();
              }}
              style={{ maxWidth: 180, letterSpacing: '0.2em' }}
            />
            {error && <span className="error">{error}</span>}
          </div>

          <div className="row" style={{ gap: 'var(--s-3)' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || code.length !== 6}
              onClick={verify}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                setStage('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different address
            </button>
          </div>

          <p className="small">
            A session lasts 12 hours. Shorter than a customer&rsquo;s, because this one can
            read across accounts.
          </p>
        </div>
      )}
    </div>
  );
}
