'use client';

/**
 * Your data: take it, or end it.
 *
 * Both operations existed in the repository, with tests, and neither had a
 * caller — an erasure right nobody could exercise is not a right. This is
 * the page that reaches them.
 *
 * Two things the copy has to do, and they pull in opposite directions. The
 * deletion has to be hard enough to reach that nobody does it by accident,
 * and honest enough that nobody thinks we are making it difficult on
 * purpose. So: a typed confirmation, the exact date stated before anything
 * happens, and a cancellation offered in the same breath.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface PendingDeletion {
  requestedAt: string;
  purgeAt: string;
  reason?: string;
}

interface AccountState {
  signedIn: boolean;
  verified?: boolean;
  email?: string | null;
  scans?: number;
  reports?: Array<{
    id: string;
    startedAt: string;
    status: string;
    isFixture: boolean;
    evidenceExpiredAt: string | null;
  }>;
  pendingDeletion?: PendingDeletion | null;
  /** The request itself failed, which is not the same as having no session. */
  unreachable?: boolean;
}

const when = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const daysUntil = (iso: string): number =>
  Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

export default function AccountClient() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A failed load has to end somewhere other than the spinner.
   *
   * The first version did `setAccount(await res.json())` and nothing else.
   * A 500 with an empty body threw inside the promise, `account` stayed
   * null, and the page sat on "Loading." indefinitely — the worst failure
   * mode available, because it looks like a slow network and the reader
   * waits.
   */
  async function load() {
    try {
      const res = await fetch('/api/account');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAccount(await res.json());
    } catch {
      setAccount({ signedIn: false, unreachable: true });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function scheduleDeletion() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE', reason: reason || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? 'That did not work. Nothing has been scheduled.');
        return;
      }
      setConfirm('');
      setReason('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/account/delete', { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return (
      <div className="wrap-narrow" style={{ padding: 'var(--s-16) var(--s-6)' }}>
        <p className="small pulse">Loading.</p>
      </div>
    );
  }

  /**
   * "We could not ask" is a different answer from "you have no account".
   *
   * Telling somebody there is nothing to delete, when in fact the request
   * failed, is a wrong answer delivered confidently — the same mistake rule
   * 14 exists to prevent on the report.
   */
  if (account.unreachable) {
    return (
      <div className="wrap-narrow stack" style={{ padding: 'var(--s-16) var(--s-6)' }}>
        <p className="eyebrow mark">Your data</p>
        <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.5rem)' }}>
          We could not reach your account
        </h1>
        <p className="lede">
          Something went wrong on our side. Nothing has been changed, exported or
          deleted.
        </p>
        <div>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!account.signedIn) {
    return (
      <div className="wrap-narrow stack" style={{ padding: 'var(--s-16) var(--s-6)' }}>
        <p className="eyebrow mark">Your data</p>
        <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.5rem)' }}>
          Nothing to show yet
        </h1>
        <p className="lede">
          There is no session here, so there is no account to export or delete.
        </p>
        <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <a href="/signin" className="btn btn-primary">
            Sign in
          </a>
          <a href="/audit" className="btn btn-secondary">
            Run an audit
          </a>
        </div>
      </div>
    );
  }

  const pending = account.pendingDeletion;

  return (
    <div
      className="wrap-narrow stack"
      style={{ padding: 'var(--s-16) var(--s-6)', ['--gap' as string]: 'var(--s-12)' }}
    >
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <p className="eyebrow mark">Your data</p>
        <h1 style={{ fontSize: 'clamp(1.8rem, 1.4rem + 1.6vw, 2.5rem)' }}>
          Take it, or end it
        </h1>
        <p className="lede">
          Everything we hold about you is yours to download, and yours to have
          destroyed.
        </p>
      </div>

      <section className="card stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
        <p className="eyebrow">This account</p>
        <dl className="small stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          <Pair
            label="Signed in as"
            value={account.email ?? 'An unverified session, with no address attached'}
          />
          <Pair label="Audits stored" value={String(account.scans ?? 0)} />
        </dl>
      </section>

      {/* ------------------------------------------------------ reports */}

      {account.reports && account.reports.length > 0 && (
        <section className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
          <h2 className="mark" style={{ fontSize: '1.5rem' }}>
            Your reports
          </h2>
          <p className="small" style={{ fontSize: '0.9375rem' }}>
            Each one opens as it stands now: if you have answered an “is this you?” since, or a
            reviewer has looked at something, the report reflects it.
          </p>
          <ul className="small stack" style={{ ['--gap' as string]: 'var(--s-2)', paddingLeft: 0, listStyle: 'none' }}>
            {account.reports.map((r) => (
              <li key={r.id}>
                <Link href={`/report/${r.id}`}>
                  {new Date(r.startedAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </Link>
                {r.isFixture && <span className="pill pill-warning" style={{ marginLeft: 8 }}>Fixture data</span>}
                {r.evidenceExpiredAt && (
                  <span className="pill pill-neutral" style={{ marginLeft: 8 }}>
                    Evidence deleted
                  </span>
                )}
                {r.status === 'search_failed' && (
                  <span className="pill pill-neutral" style={{ marginLeft: 8 }}>
                    Did not complete
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------- export */}

      <section className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <h2 className="mark" style={{ fontSize: '1.5rem' }}>
          Download everything
        </h2>
        <p className="small" style={{ fontSize: '0.9375rem' }}>
          A JSON file with your audits, the evidence behind them, every score we
          have recorded and when it changed, your own &ldquo;is this
          me&rdquo; decisions, and the log of what was done to this account.
        </p>
        <p className="small">
          Two things are deliberately not in it: the identity of any reviewer who
          looked at a flagged record, which is a member of staff rather than part
          of your data; and the text of results we withheld, which we never
          stored in the first place.
        </p>
        <div>
          <a href="/api/account/export" className="btn btn-secondary" download>
            Download my data
          </a>
        </div>
      </section>

      {/* ----------------------------------------------------- deletion */}

      <section className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <h2 className="mark" style={{ fontSize: '1.5rem' }}>
          Delete this account
        </h2>

        {pending ? (
          <>
            <div className="notice notice-warning">
              <div>
                <strong>
                  Scheduled for {when(pending.purgeAt)}
                </strong>
                That is {daysUntil(pending.purgeAt)} days away. Until then nothing
                has been destroyed and you can still download your data. On that
                date every audit, every piece of evidence and this account itself
                are deleted outright: not flagged, not archived.
              </div>
            </div>
            <p className="small">
              Requested {when(pending.requestedAt)}. Audits will not run while a
              deletion is scheduled.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={cancelDeletion}
                disabled={busy}
              >
                Keep my account
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="small" style={{ fontSize: '0.9375rem' }}>
              We wait 30 days before destroying anything, so a decision made in a
              bad moment is recoverable. Nothing is hidden in the meantime, and
              you can cancel at any point. After that it is gone, and we cannot
              get it back for you.
            </p>

            <div className="field">
              <label className="label" htmlFor="reason">
                Why, if you want to say <span style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="reason"
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="No longer needed"
              />
              <span className="hint">
                Kept until the account is purged, and read by us to understand why
                people leave. It never changes what happens next.
              </span>
            </div>

            <div className="field">
              <label className="label" htmlFor="confirm">
                Type DELETE to confirm
              </label>
              <input
                id="confirm"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
              />
              <span className="hint">
                A deliberate step, not a security measure. Being signed in is what
                authorises this; typing it is what stops it happening by accident.
              </span>
            </div>

            {error && <p className="error">{error}</p>}

            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={scheduleDeletion}
                disabled={busy || confirm !== 'DELETE'}
              >
                Schedule deletion
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', gap: 'var(--s-4)' }}>
      <dt style={{ minWidth: 130, color: 'var(--text-2)' }}>{label}</dt>
      <dd style={{ color: 'var(--text)' }}>{value}</dd>
    </div>
  );
}
