/**
 * Who, if anyone, may use the review queue.
 *
 * A named member of staff, signed in with their own address, and nobody
 * else. The scope comes from the staff session cookie and is resolved server
 * side against the staff table on every request.
 *
 * Three things this does **not** do, each on purpose:
 *
 *   - It does not read an id from the request. A reviewer id in a body or a
 *     query string is a reviewer id anyone can type.
 *   - It does not accept a customer session. The cookie is a different name
 *     over a different table; there is no flag on a customer account that
 *     turns into staff access.
 *   - It does not cache. Disabling someone takes effect on their next
 *     request, not when something expires.
 *
 * Fails closed: no cookie, an unknown token, an expired session or a disabled
 * staff row all produce null, and the routes answer 404 for all of them so
 * probing cannot tell the queue exists.
 *
 * This replaces the REP_REVIEWER_ID environment variable, which was one
 * shared identity per deployment. Every decision was attributed to it, which
 * looked like per-person attribution and was not. See docs/OPEN_QUESTIONS.md
 * OQ-16.
 */
import type { ReviewerScope } from '@rep/persistence';
import { currentStaff } from './staffSession.ts';

export async function reviewerScope(): Promise<ReviewerScope | null> {
  const staff = await currentStaff();
  if (!staff) return null;

  return { reviewerId: staff.reviewerId, role: staff.role };
}
