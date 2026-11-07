'use client';

import { useCallback, useEffect, useState } from 'react';
import { Report, type CompleteReport, type ScoreHistoryEntry } from '../../components/Report';
import { Notice } from '../../components/Notice';

interface Reassessment {
  from: string;
  to: string;
  previousScore: number | null;
  currentScore: number | null;
  previousAt: string;
  reason: string;
}

type Response =
  | ({ status: 'complete'; scanId: string; identity: { fullName: string };
      presenceHistory?: ScoreHistoryEntry[]; reassessed?: Reassessment | null } & CompleteReport)
  | { status: 'evidence_expired'; expiredAt: string; startedAt: string;
      identity: { fullName: string }; presenceHistory?: ScoreHistoryEntry[] }
  | { status: 'search_failed'; failure?: { reason?: string } }
  | { status: 'not_found' }
  | { status: 'no_session' };

export default function ReportPage({ scanId }: { scanId: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/scan/${encodeURIComponent(scanId)}`);
    if (res.status === 401) return setData({ status: 'no_session' });
    if (res.status === 404) return setData({ status: 'not_found' });
    setData(await res.json());
  }, [scanId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(evidenceId: string, decision: 'confirmed' | 'rejected') {
    setPendingId(evidenceId);
    try {
      await fetch(`/api/scan/${encodeURIComponent(scanId)}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidenceId, decision }),
      });
      await load();
    } finally {
      setPendingId(null);
    }
  }

  if (!data) return <p className="small">Loading…</p>;

  if (data.status === 'no_session') {
    return (
      <Notice tone="info" icon="lock" title="Sign in to open this report">
          <p className="small">
            A report is only ever shown to the account that ran it. The address bar is not
            enough, deliberately.
          </p>
          <p className="small">
            <a href="/signin">Sign in</a>
          </p>
      </Notice>
    );
  }

  /**
   * One answer for "no such scan" and "not yours".
   *
   * Telling them apart would make this page a way to find out which scan ids
   * are real, which is the one thing an identifier must not reveal when the
   * thing it identifies is a report about a named person.
   */
  if (data.status === 'not_found') {
    return (
      <Notice tone="info" title="No report here">
          <p className="small">
            Either this report does not exist or it belongs to another account. We do not say
            which.
          </p>
      </Notice>
    );
  }

  if (data.status === 'search_failed') {
    return (
      <Notice tone="warning" title="This audit did not complete">
          <p className="small">
            The search provider failed, so there is nothing to report. That is different from
            finding nothing, and we will not show you one as the other.
          </p>
      </Notice>
    );
  }

  /**
   * An expired scan is not an empty one (rule 16x).
   *
   * Evidence excerpts age out at 180 days and the scores do not. Rebuilding
   * from no evidence would produce a well-formed report saying we found
   * almost nothing about this person, which reads exactly like a real result
   * and is not one.
   */
  if (data.status === 'evidence_expired') {
    return (
      <Notice tone="info" icon="clock" title="The evidence behind this report has been deleted">
          <p className="small">
            This audit ran on {new Date(data.startedAt).toLocaleDateString()}. We keep the
            quotations for six months and then delete them, so the report cannot be rebuilt.
            What it scored, and when, is kept.
          </p>
          {data.presenceHistory && data.presenceHistory.length > 0 && (
            <ul className="small stack" style={{ paddingLeft: 18, marginTop: 8 }}>
              {data.presenceHistory.map((h, i) => (
                <li key={i}>
                  {h.score ?? 'Not scored'} · {new Date(h.computedAt).toLocaleDateString()} · {h.reason}
                </li>
              ))}
            </ul>
          )}
      </Notice>
    );
  }

  return (
    /**
     * `rise` is used here and not on pages that load instantly. A report
     * arrives after a wait, and a thing that appears with no transition
     * after a wait reads as a page reloading rather than as work finishing.
     * At `prefers-reduced-motion` it is an instant appearance, not a jump.
     */
    <div className="rise">
      {data.reassessed && <ReassessedNotice r={data.reassessed} />}
      <Report
        report={data}
        name={data.identity.fullName}
        onDecision={decide}
        pendingId={pendingId}
        history={data.presenceHistory ?? []}
      />
    </div>
  );
}

/**
 * Said out loud, because the alternative is a number that moved on its own.
 *
 * A report rebuilt on read after the engine changed shows a different score
 * under the original date. Nobody added evidence and nobody decided
 * anything, so without this the customer is looking at a different claim
 * wearing the same timestamp.
 */
function ReassessedNotice({ r }: { r: Reassessment }) {
  const moved = r.previousScore !== null && r.currentScore !== null && r.previousScore !== r.currentScore;

  return (
    <Notice
      tone="info"
      icon="clock"
      className="no-print"
      title="This report has been reassessed since you last saw it"
    >
        <p className="small">
          {moved ? (
            <>
              It scored {r.previousScore} on {new Date(r.previousAt).toLocaleDateString()} and
              scores {r.currentScore} now.{' '}
            </>
          ) : (
            <>The figures are unchanged. </>
          )}
          No new evidence was gathered and nobody made a decision: {r.reason}. The earlier
          assessment is kept in the history below with its own date and version.
        </p>
    </Notice>
  );
}
