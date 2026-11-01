/**
 * GET /api/scan/[id]/status — where a queued audit has got to.
 *
 * The client polls this while a job runs. It reports the scan's own status
 * plus the job's, because they answer different questions: the scan says
 * whether a report exists, the job says whether anything is still trying.
 *
 * A scan stuck `pending` with a `failed` job is the case worth being able to
 * see — it is the difference between "still working" and "gave up", and
 * collapsing the two is how a spinner runs forever.
 */
import { NextRequest, NextResponse } from 'next/server';
import { store } from '../../../../../src/server/db.ts';
import { currentScope } from '../../../../../src/server/session.ts';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = await currentScope();
  if (!scope) return NextResponse.json({ error: 'No session.' }, { status: 401 });

  const { id } = await ctx.params;
  const { repo, queue } = store();

  const scan = repo.getScan(scope, id);
  if (!scan) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const job = queue.forSubject(scope, 'scan', id);

  const state =
    scan.status === 'complete'
      ? 'ready'
      : scan.status === 'search_failed'
        ? 'failed'
        : job?.status === 'failed'
          ? 'failed'
          : 'working';

  return NextResponse.json(
    {
      state,
      scanId: id,
      scanStatus: scan.status,
      job: job
        ? {
            status: job.status,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            lastError: job.status === 'failed' ? job.lastError : undefined,
          }
        : null,
      failure: scan.failure,
      // What is known before the work finishes, so the waiting screen can
      // say something true rather than inventing progress.
      queries: scan.queries,
      provider: scan.provider,
      isFixture: scan.isFixture,
    },
    { status: 200 }
  );
}
