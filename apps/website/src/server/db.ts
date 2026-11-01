/**
 * The database connection, opened once per process.
 *
 * SQLite on local disk. That is genuinely durable — it survives restarts,
 * which is what the in-memory store did not — but it is single-machine, so it
 * does not survive horizontal scaling. Moving to Postgres is a change in this
 * file plus the driver underneath the repository, not in any caller.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  open,
  AuthRepository,
  JobQueue,
  OutboxDeliverer,
  ReviewRepository,
  ScanRepository,
  SqliteAttemptStore,
  StaffAuthRepository,
  type Db,
} from '@rep/persistence';

const location = resolve(
  process.env.REP_DB_PATH ?? resolve(process.cwd(), '.data', 'rep.db')
);

declare global {
  // eslint-disable-next-line no-var
  var __repDb:
    | {
        db: Db;
        repo: ScanRepository;
        attempts: SqliteAttemptStore;
        auth: AuthRepository;
        email: OutboxDeliverer;
        queue: JobQueue;
        review: ReviewRepository;
        staffAuth: StaffAuthRepository;
      }
    | undefined;
}

function create() {
  mkdirSync(dirname(location), { recursive: true });
  const db = open({ location });
  return {
    db,
    repo: new ScanRepository(db),
    attempts: new SqliteAttemptStore(db),
    auth: new AuthRepository(db),
    // No mail provider is configured. The deliverer says so rather than
    // pretending, and the sign-in route passes that through to the UI.
    email: new OutboxDeliverer(db),
    queue: new JobQueue(db),
    review: new ReviewRepository(db),
    // Staff sign-in. Separate from `auth` because a customer session and a
    // staff session must never be the same object with a flag on it.
    staffAuth: new StaffAuthRepository(db),
  };
}

/**
 * Cached on `globalThis` so the dev server's module reloading does not open a
 * new connection on every edit and leave the old ones holding the WAL.
 */
export function store() {
  if (!globalThis.__repDb) globalThis.__repDb = create();
  return globalThis.__repDb;
}
