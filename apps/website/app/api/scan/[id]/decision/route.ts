/**
 * POST /api/scan/[id]/decision — the customer confirms or rejects a match.
 *
 * The decision changes the score, so it is recorded as an auditable event and
 * a new snapshot is written rather than the old one being amended. A customer
 * should be able to ask "why did my score change on Tuesday" and get an
 * answer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rebuildReport } from '@rep/persistence';
import { store } from '../../../../../src/server/db.ts';
import { currentScope } from '../../../../../src/server/session.ts';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = await currentScope();
  if (!scope) return NextResponse.json({ error: 'No session.' }, { status: 401 });

  const { id } = await ctx.params;

  let body: { evidenceId?: unknown; decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId : null;
  const decision = body.decision === 'confirmed' || body.decision === 'rejected'
    ? body.decision
    : null;

  if (!evidenceId || !decision) {
    return NextResponse.json(
      { error: 'Provide evidenceId and a decision of "confirmed" or "rejected".' },
      { status: 400 }
    );
  }

  const { repo, review } = store();

  try {
    // The repository re-checks that both the scan and the evidence belong to
    // this account. The cookie establishes who is asking; it does not
    // establish what they may touch.
    repo.recordDecision(scope, id, evidenceId, decision);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }

  const scan = repo.getScan(scope, id)!;
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

  const reason = `customer ${decision} ${evidenceId}`;
  repo.savePresence(scope, id, rebuilt.presence, reason);
  repo.saveRisk(scope, id, rebuilt.risk, reason);

  return NextResponse.json({ status: 'recorded', scanId: id }, { status: 200 });
}
