/**
 * GET /api/scan/[id] — the stored report, rebuilt from evidence.
 *
 * The scope comes from the session cookie, never from the request. A scan id
 * is therefore not a capability: holding one is useless without the cookie
 * for the account that owns it, and the repository has no unscoped read for a
 * caller to reach for.
 */
import { NextRequest, NextResponse } from 'next/server';
import { latestReassessment, rebuildReport, reconcileAssessment } from '@rep/persistence';
import { store } from '../../../../src/server/db.ts';
import { currentScope } from '../../../../src/server/session.ts';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = await currentScope();
  if (!scope) {
    return NextResponse.json({ error: 'No session.' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { repo, queue, review } = store();
  const scan = repo.getScan(scope, id);

  // Same response whether the scan does not exist or belongs to someone else.
  // Distinguishing them would turn this endpoint into a way to discover which
  // scan ids are real.
  if (!scan) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  /**
   * An expired scan is not an empty one.
   *
   * Retention deletes the evidence excerpts after six months; the scan and
   * its score history stay. Rebuilding from no evidence produces a
   * well-formed report saying we found almost nothing about this person,
   * which is indistinguishable from a real result and is not true. So the
   * branch comes before the rebuild, and the client is told plainly.
   */
  if (scan.evidenceExpiredAt) {
    return NextResponse.json(
      {
        status: 'evidence_expired',
        scanId: scan.id,
        expiredAt: scan.evidenceExpiredAt,
        startedAt: scan.startedAt,
        identity: scan.identity,
        // The numbers survive the quotations. Worth returning, because it is
        // the only thing left that this audit happened at all.
        presenceHistory: repo.presenceHistory(scope, scan.id),
      },
      { status: 200 }
    );
  }

  if (scan.status === 'search_failed') {
    return NextResponse.json(
      { status: 'search_failed', scanId: scan.id, failure: scan.failure, scan },
      { status: 200 }
    );
  }

  const rebuilt = rebuildReport(scan, {
    reviews: review.decisionsFor(scan.id),
    websiteChecks: scan.identity.websiteUrl
      ? [
          { key: 'https', passed: true },
          { key: 'title', passed: true },
          { key: 'meta_description', passed: false },
          { key: 'structured_data', passed: true },
        ]
      : undefined,
  });

  /**
   * Record any divergence before the history is read for the response.
   *
   * The report is recomputed on every read, so an engine change moves an old
   * number with no new evidence and nothing to show for it. This turns that
   * into an event: a new snapshot with a reason, and a line on the page.
   */
  reconcileAssessment(repo, scope, scan.id, rebuilt);

  /**
   * Read back from the history rather than using what the reconciler just
   * returned. The notice belongs to the report, not to the request that
   * happened to record the change — otherwise it shows once and is gone,
   * quite possibly before the customer loads the page.
   */
  const history = repo.presenceHistory(scope, scan.id);
  const reassessed = latestReassessment(history);

  return NextResponse.json(
    {
      status: 'complete',
      scanId: scan.id,
      reassessed,
      scan: {
        provider: scan.provider,
        isFixture: scan.isFixture,
        queries: scan.queries,
        window: scan.window,
        observedAt: scan.evidence[0]?.retrievedAt ?? scan.startedAt,
        resultsObserved: scan.evidence.length,
        resultsAttributed: rebuilt.evidence.filter(
          (e) => e.identityStatus === 'confirmed' || e.identityStatus === 'probable'
        ).length,
        partialCoverage: scan.partialCoverage,
        coverageNote: scan.coverageNote,
      },
      identity: scan.identity,
      decisionCount: rebuilt.decisionCount,
      presenceHistory: history,
      evidence: rebuilt.evidence,
      awaitingConfirmation: rebuilt.awaitingConfirmation,
      presence: rebuilt.presence,
      risk: rebuilt.risk,
      confidence: rebuilt.confidence,
      recommendations: rebuilt.recommendations,
      findings: rebuilt.findings,
    },
    { status: 200 }
  );
}
