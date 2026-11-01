'use client';

/**
 * Sign-in: email, then a code.
 *
 * Two things this interface does not do.
 *
 * It does not tell you whether the address has an account — the message after
 * requesting a code is identical either way, because a different one would
 * let anyone test whether a given person is a customer of a reputation
 * service.
 *
 * It does not claim an email was sent. No mail provider is configured, so the
 * response says `delivered: false` and the page shows the code it generated
 * instead of pointing at an inbox that will stay empty.
 */
import { useState } from 'react';

type Stage = 'email' | 'code' | 'done';

export default function SignInClient() {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(true);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [orphaned, setOrphaned] = useState(0);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (data.status === 'sent') {
        setDelivered(data.delivered);
        setStage('code');

        // Only reachable because nothing is really sent. With a provider
        // configured this disappears and the code never leaves the server.
        if (!data.delivered) {
          const out = await fetch(`/api/auth/outbox?email=${encodeURIComponent(email)}`);
          if (out.ok) {
            const body = await out.json();
            setDevCode(body.code ?? null);
          }
        }
      } else {
        setError(data.message ?? 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();

      if (data.status === 'signed_in') {
        setClaimed(Boolean(data.claimed));
        setOrphaned(Number(data.orphanedScans ?? 0));
        setStage('done');
      } else {
        setError(data.message ?? 'That did not work.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap-narrow" style={{ padding: '48px 24px 72px' }}>
      {stage === 'email' && (
        <form className="stack" style={{ ['--gap' as string]: '22px' }} onSubmit={request}>
          <div>
            <p className="eyebrow">Sign in</p>
            <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.4rem)' }}>
              Sign in with your email
            </h1>
            <p className="lede" style={{ marginTop: 10 }}>
              There is no password. We send a short code, and it works once.
            </p>
          </div>

          <div className="card stack" style={{ ['--gap' as string]: '16px' }}>
            <div className="field">
              <label className="label" htmlFor="email">Email address</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <span className="hint">
                Verifying an address is what lets you audit a name other than the one you
                started with.
              </span>
            </div>

            {error && <p className="error">{error}</p>}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Working…' : 'Send me a code'}
            </button>
          </div>

          <p className="small">
            We will not say whether that address already has an account. Confirming it either
            way would let anyone check whether a particular person uses this service.
          </p>
        </form>
      )}

      {stage === 'code' && (
        <form className="stack" style={{ ['--gap' as string]: '22px' }} onSubmit={verify}>
          <div>
            <p className="eyebrow">Sign in</p>
            <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.4rem)' }}>Enter your code</h1>
          </div>

          {!delivered && (
            <div className="notice notice-warning">
              <div>
                <strong>No email was sent</strong>
                No mail provider is configured, so nothing left the server. The code below was
                written to the outbox table instead.
                {devCode && (
                  <p className="mono" style={{ marginTop: 10, fontSize: '1.4rem', letterSpacing: '0.2em' }}>
                    {devCode}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="card stack" style={{ ['--gap' as string]: '16px' }}>
            <div className="field">
              <label className="label" htmlFor="code">Six-digit code</label>
              <input
                id="code"
                className="input mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                style={{ fontSize: '1.3rem', letterSpacing: '0.3em' }}
                required
              />
              <span className="hint">It expires in ten minutes and can be used once.</span>
            </div>

            {error && <p className="error">{error}</p>}

            <div className="row" style={{ gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || code.length < 6}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setStage('email');
                  setCode('');
                  setError(null);
                }}
              >
                Use a different address
              </button>
            </div>
          </div>
        </form>
      )}

      {stage === 'done' && (
        <div className="stack" style={{ ['--gap' as string]: '20px' }}>
          <div>
            <p className="eyebrow">Signed in</p>
            <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.4rem)' }}>
              You are signed in as {email}
            </h1>
          </div>

          {claimed && (
            <div className="notice notice-info">
              <div>
                <strong>Your earlier audit came with you</strong>
                The report you ran before signing in now belongs to this account.
              </div>
            </div>
          )}

          {orphaned > 0 && (
            <div className="notice notice-warning">
              <div>
                <strong>
                  {orphaned} earlier {orphaned === 1 ? 'report is' : 'reports are'} not on this
                  account
                </strong>
                This email already had an account, so we signed you into that one. Combining
                two accounts cannot be undone, so we have not done it without asking.
              </div>
            </div>
          )}

          <p>
            <a href="/audit" className="btn btn-primary">Run an audit</a>
          </p>
        </div>
      )}
    </div>
  );
}
