/**
 * The in-process job worker.
 *
 * Polls the queue, runs the handler, records the result. Started lazily on
 * first use so a build or a one-off script does not spin one up.
 *
 * **This is a single-process worker and it dies with the server.** That is
 * adequate while the provider is a fixture and the database is a local file,
 * and it is not adequate once either changes: a deploy mid-audit loses the
 * run, and nothing here coordinates across machines. `reclaimStalled` limits
 * the damage by returning abandoned jobs to the queue, but a real deployment
 * wants a worker process of its own. Written down rather than discovered.
 */
import { runAudit, FixtureSearchProvider, type AuditPurpose, type FixtureScenario, type ProfessionalIdentity } from '@rep/domain';
import { enforceRetention, type JobRecord } from '@rep/persistence';
import { store } from './db.ts';

const POLL_MS = 400;
const STALLED_AFTER_SECONDS = 600;
/**
 * How often retention runs.
 *
 * Not a queued job. The queue is per-account — every row carries an
 * account_id — and retention is a sweep across all of them, so pushing it
 * through the queue would mean inventing an account for it to belong to.
 * A timer in the worker is the honest shape, and it is written down here
 * rather than discovered by someone wondering why there is no job type.
 */
const RETENTION_EVERY_MS = 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __repWorker:
    | { timer: NodeJS.Timeout; retention: NodeJS.Timeout; running: boolean }
    | undefined;
}

/** Payload for an `audit` job. Written by the route, read here. */
export interface AuditJobPayload {
  identity: ProfessionalIdentity;
  purpose: AuditPurpose;
  scenario: FixtureScenario;
  requesterId: string;
  scanId: string;
  websiteChecks?: { key: string; passed: boolean }[];
}

async function runAuditJob(job: JobRecord): Promise<void> {
  const { repo, queue } = store();
  const p = job.payload as unknown as AuditJobPayload;
  const scope = { accountId: job.accountId, actor: 'system' };

  const report = await runAudit({
    identity: p.identity,
    purpose: p.purpose,
    provider: new FixtureSearchProvider(p.scenario),
    websiteChecks: p.websiteChecks,
    // The gate already ran in the request, before the job was created. A
    // blocked audit never becomes a job, so re-running the gate here would
    // only double-count the attempt against the customer's own limit.
  });

  if (report.status !== 'complete') {
    const reason =
      report.status === 'search_failed'
        ? `${report.reason}: ${report.message}`
        : `audit returned ${report.status}`;

    /**
     * A retryable failure must not mark the scan.
     *
     * Writing `search_failed` on the first attempt told the customer the
     * audit had failed while the job was still queued to try again — a
     * terminal answer to a question that was not settled. The scan stays
     * `pending` through the retries, and only the final give-up writes the
     * failure. That happens in `tick`, which is the only place that knows
     * an attempt was the last one.
     */
    if (report.status === 'search_failed' && report.reason === 'provider_error') {
      throw new Error(reason);
    }

    // Anything else is settled on the first answer: rate limiting and a
    // refused request do not become true by asking again.
    repo.completeScan(scope, p.scanId, {
      status: 'search_failed',
      failure: {
        reason: report.status === 'search_failed' ? report.reason : report.status,
        message: reason,
      },
    });
    return;
  }

  repo.completeScan(scope, p.scanId, {
    status: 'complete',
    evidence: report.evidence,
    coverageNote: report.scan.coverageNote,
    partialCoverage: report.scan.partialCoverage,
  });

  repo.savePresence(scope, p.scanId, report.presence, 'initial scan');
  repo.saveRisk(scope, p.scanId, report.risk, 'initial scan');

  void queue;
}

const HANDLERS: Record<string, (job: JobRecord) => Promise<void>> = {
  audit: runAuditJob,
};

async function tick(): Promise<void> {
  const { queue } = store();

  queue.reclaimStalled(STALLED_AFTER_SECONDS);

  const job = queue.claim();
  if (!job) return;

  const handler = HANDLERS[job.type];
  if (!handler) {
    queue.fail(job.id, `No handler registered for job type "${job.type}".`);
    return;
  }

  try {
    await handler(job);
    queue.succeed(job.id);
  } catch (err) {
    const message = (err as Error).message;
    const { willRetry } = queue.fail(job.id, message);

    // Only the last attempt writes a terminal state onto the subject. While
    // retries remain the scan stays pending, because it genuinely is.
    if (!willRetry && job.subjectType === 'scan' && job.subjectId) {
      try {
        store().repo.completeScan(
          { accountId: job.accountId, actor: 'system' },
          job.subjectId,
          {
            status: 'search_failed',
            /**
             * What the customer reads, not what the exception said.
             *
             * `message` here is the thrown error — "provider_error:
             * Simulated upstream failure." — and it was being written
             * straight onto the scan and rendered. Somebody asking what the
             * internet says about them got a prefixed error code and the
             * word "Simulated".
             *
             * The technical detail is not lost: `queue.fail` has already
             * stored it on the job row, which is where an operator looks.
             * The code itself still reaches the screen as `failure.reason`,
             * shown in monospace as a reference rather than as prose.
             */
            failure: {
              reason: 'provider_error',
              message:
                'The search provider did not respond, and we stopped after ' +
                `${job.attempts} attempts. Nothing was scored and nothing ` +
                'partial was saved, so running this again starts cleanly.',
            },
          }
        );
      } catch {
        // The scan may already be gone if the account was deleted mid-job.
      }
    }
  }
}

/**
 * Ages out data whose period has passed.
 *
 * Runs on a timer rather than on a schedule somebody has to remember to set
 * up. A retention policy that only runs when a human triggers it is a
 * retention policy that has not run.
 */
function sweep(): void {
  try {
    const result = enforceRetention(store().db);
    if (result.scansExpired > 0 || result.evidenceDeleted > 0) {
      console.log(
        `[retention] expired ${result.scansExpired} scan(s), ` +
          `deleted ${result.evidenceDeleted} evidence row(s)`
      );
    }
  } catch (err) {
    // A failed sweep must never take the worker down with it: the audits it
    // is running matter more than this hour's housekeeping.
    console.error('[retention] sweep failed:', (err as Error).message);
  }
}

export function startWorker(): void {
  if (globalThis.__repWorker) return;

  const state = {
    timer: null as unknown as NodeJS.Timeout,
    retention: null as unknown as NodeJS.Timeout,
    running: false,
  };

  sweep();
  state.retention = setInterval(sweep, RETENTION_EVERY_MS);
  state.retention.unref?.();

  state.timer = setInterval(() => {
    // One job at a time. Overlapping ticks would claim a second job while the
    // first is still running, which the queue allows but this process has no
    // reason to do.
    if (state.running) return;
    state.running = true;
    void tick().finally(() => {
      state.running = false;
    });
  }, POLL_MS);

  // Never hold the process open on this alone.
  state.timer.unref?.();

  globalThis.__repWorker = state;
}
