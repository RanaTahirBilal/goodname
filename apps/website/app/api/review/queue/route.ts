/**
 * GET /api/review/queue — records waiting for a human.
 *
 * The only endpoint in this product that returns data across accounts, which
 * is why it is gated on a named staff member and why every row it returns is
 * logged against them.
 */
import { NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { reviewerScope } from '../../../../src/server/reviewer.ts';

export async function GET() {
  const scope = await reviewerScope();

  // Same answer whether review is switched off or the caller is not staff.
  // Distinguishing them would confirm the queue exists to someone probing.
  if (!scope) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { review } = store();

  return NextResponse.json(
    { items: review.queue(scope), pending: review.pendingCount(), reviewer: scope.reviewerId },
    { status: 200 }
  );
}
