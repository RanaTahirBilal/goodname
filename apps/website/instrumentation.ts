/**
 * Starts the background worker when the server starts.
 *
 * It used to start lazily, on the first audit request, and that was wrong in
 * a way that only became visible once scheduled deletion existed.
 *
 * The worker runs two sweeps: retention, which ages out evidence, and the
 * purge, which destroys accounts whose grace period has ended. Both are
 * obligations with a clock on them, and neither has anything to do with
 * somebody submitting an audit. A quiet instance never ran either. Worse,
 * the normal thing to do after asking for your account to be deleted is
 * never to come back — so the one user whose data most needed destroying was
 * the one least likely to trigger the code that destroys it.
 *
 * Next calls `register()` once per server process, before handling any
 * request, which is what "on start" actually means here.
 */
export async function register(): Promise<void> {
  // Only the Node runtime has timers, SQLite, or any of this. The edge
  // runtime loads this file too and must do nothing with it.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startWorker } = await import('./src/server/worker.ts');
  startWorker();
}
