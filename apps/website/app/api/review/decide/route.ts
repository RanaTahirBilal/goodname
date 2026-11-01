/**
 * POST /api/review/decide — a reviewer's judgement on one record.
 *
 * The rationale is enforced in the repository, not here, so the rule holds
 * for any caller rather than only for this route.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ReviewOutcome } from '@rep/domain';
import { store } from '../../../../src/server/db.ts';
import { reviewerScope } from '../../../../src/server/reviewer.ts';

const OUTCOMES: ReviewOutcome[] = [
  'uphold',
  'downgrade_to_allegation',
  'reject_not_this_person',
  'reject_not_harm',
];

export async function POST(req: NextRequest) {
  const scope = await reviewerScope();
  if (!scope) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: { scanId?: unknown; evidenceId?: unknown; outcome?: unknown; rationale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const scanId = typeof body.scanId === 'string' ? body.scanId : null;
  const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId : null;
  const rationale = typeof body.rationale === 'string' ? body.rationale : '';
  const outcome = OUTCOMES.includes(body.outcome as ReviewOutcome)
    ? (body.outcome as ReviewOutcome)
    : null;

  if (!scanId || !evidenceId || !outcome) {
    return NextResponse.json(
      { error: 'Provide scanId, evidenceId and a valid outcome.' },
      { status: 400 }
    );
  }

  try {
    store().review.decide(scope, scanId, evidenceId, outcome, rationale);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  return NextResponse.json({ status: 'recorded' }, { status: 200 });
}
