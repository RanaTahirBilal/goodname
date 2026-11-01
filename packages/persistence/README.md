# Persistence

Durable storage for scans, evidence, customer decisions and audit events.

```
npm test --workspace @rep/persistence
```

## Why SQLite

No Postgres has been provisioned and none can be from here, so this uses
`node:sqlite` — built into Node, no dependency to add, a real database with
real transactions and foreign keys.

It is genuinely durable: it survives restarts, which is the whole reason this
package exists. It is **not** horizontally scalable — one file, one machine.
Moving to Postgres changes `db.ts` and the driver calls underneath the
repository, and no caller.

The SQL is deliberately portable: no SQLite-only types, no `INSERT OR
REPLACE`, no implicit rowid dependence.

## Account isolation is in the API shape

Every method takes an `AccountScope` and every query filters on `account_id`.

There is deliberately **no `getScan(id)`**. A caller cannot read another
account's scan by guessing an id, because the method to do it does not exist.
Relying on each caller to remember a `WHERE account_id = ?` is how
cross-tenant leaks happen, and the compiler cannot catch a forgotten clause.

Tested directly: a second account holding a valid scan id gets `null` from
every read, and is refused when it tries to record a decision.

## Snapshots are append-only

A rescore writes a new row with the reason it happened. It never updates the
previous one.

That is what lets a customer ask "why is my score different from last week"
and get an answer. It also means a methodology change is visible as a
discontinuity rather than a silent restatement — which `SCORING_SPEC.md`
requires.

Reports themselves are **not** stored. The three outputs are derived, so they
are recomputed from evidence on read. Storing a rendered report would mean a
customer decision silently invalidates it, and what someone sees depends on
whether anything refreshed a cache.

## Customer decisions

`identity_decisions` records a customer confirming or rejecting an uncertain
match. The customer is the authority on whether a result is about them, so the
decision overrides our estimate outright rather than nudging it — but the
original confidence and the signals behind it stay on the evidence record, so
the report can still show why we were unsure.

Changing a decision replaces it. Both the write and the replacement are
logged, because the decision moves a score.

## Deletion

`deleteAccount` hard-deletes every row for the account, audit events included
— those name the account and what it did, which is exactly the personal data a
deletion request is about.

What survives is one row in `deletion_log`: a one-way reference and row
counts, no personal data. Enough to show a deletion happened; useless for
anything else. There is a test asserting the account id does not appear in it.

## Attempt store

`SqliteAttemptStore` replaces the in-memory store the safeguards used.

That store reset on deploy and was per-instance, which meant the enumeration
limits could be cleared by waiting for a restart. `docs/SAFEGUARDS.md` listed
it as a launch blocker; this closes it, and there are tests that exercise the
gate across a close-and-reopen.

`prune()` deletes attempts past retention — those rows hold a name someone
typed, and there is no reason to keep it once it can no longer affect a
rate-limit decision. Nothing calls it on a schedule yet.

## Not done

- Encryption at rest. The file is readable by anything with filesystem access.
- Retention policy. `prune()` exists; no job runs it.
- Postgres. The interface is ready; the driver is not written.
