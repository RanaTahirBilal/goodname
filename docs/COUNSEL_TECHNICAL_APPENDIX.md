# Technical appendix to the launch review request

**Companion to `LEGAL_REVIEW_REQUEST.md`.** That document asks the questions.
This one describes the implementation they are being asked about.

**Status:** draft, not sent. Accurate as of 2026-11-05, against the code at
commit `03e36f0`.

Everything below was read out of the source rather than recalled, and each
section names the files so a reviewer can check it. It contains **no legal
conclusions and no compliance claims.** Where a control does not exist, or
exists only in development form, it says so.

---

## 0. The one thing to read first

**No live search provider is connected. No mail provider is connected. No
report has ever been produced about a real person.**

Every audit in the system has run against fixture data describing invented
people. The fixture flag is a column on the scan (`scans.is_fixture`), is
carried through to the report payload, and is rendered on screen. There is no
code path that produces a report from live search results, because there is no
provider to call.

This means the data flows below describe what the system **would** do with
real data if a provider were connected. The schema, the retention sweep, the
deletion path and the access controls are all built and tested; the input to
them is synthetic.

---

## 1. What data is collected, and from where

### 1a. From the customer, typed by them

| Field | Table.column | Required |
|---|---|---|
| Email address | `accounts.email` | Yes, to sign in |
| Full name | `professional_identities.full_name` | Yes |
| Profession | `professional_identities.profession` | Yes, one of: attorney, physician, founder, executive, other |
| Employer | `professional_identities.employer` | No |
| City | `professional_identities.city` | No |
| Region / state | `professional_identities.region` | No |
| Credentials | `professional_identities.credentials` (JSON array) | No |
| Own website | `professional_identities.website_url` | No |
| Known aliases | carried in the query plan | No |

These are the only fields the customer supplies. There is no date of birth, no
address, no phone number, no government identifier, no payment data. There is
no payment system.

`packages/domain/src/audit.ts` → `validateIdentity`, `buildQueries`.

### 1b. The attestation

Before an audit runs, the customer confirms a fixed sentence:

> "I confirm this audit is about me, and that I am not using it to research
> another person."

The **exact text shown** is stored on the scan record along with the timestamp
(`scans.purpose`, holding `attestationText` and `attestedAt`), so the record
carries the words the customer agreed to rather than a boolean.

`packages/domain/src/safeguards.ts` → `SELF_AUDIT_ATTESTATION`.

### 1c. From the search provider, per result

Returned by the provider and stored on the `evidence` row:

- `source_url`, `source_name`, `domain`
- `position` (rank in the result page)
- `title`, `excerpt` — **this is the personal data**
- `published_at` where the provider gives one
- `retrieved_at` — our own clock
- `provider_name`, `provenance`

### 1d. Derived by us, per result

Computed by the engine, never supplied by the customer or the provider:

- `identity_confidence` (0–1), `identity_status`, `identity_signals`
  (the named reasons a match scored what it did, in words)
- `classification`, `classification_conf`, `classification_reason`
- `source_reliability`, `authority`
- `finding_status`, `severity`, `severity_rationale`
- `review_status`
- `story_cluster_id`, `duplicate_of`, `independent_sources`,
  `contradicted_by`, `correction_of`
- `sensitivity_categories`, `sensitivity_signals`, `sensitivity_withheld`
- `created_by`, `distribution`, `editorial_independence`, `campaign_id`
  (authorship and commercial relationship — see §9)

### 1e. Operational data

- `audit_attempts` — requester id, a normalised subject key, the subject name,
  the purpose, and the time. Used for rate limiting and enumeration detection.
  **This table is not scoped to an account** and is discussed in §5.
- `jobs` — queued work. The payload holds the identity (name, employer, city),
  which is why `jobs` is in the account-deletion list.
- `audit_events` — actor, action, subject type, subject id. **Never payloads.**
- `email_outbox` — messages that would have been sent (see §8).
- `sign_in_tokens`, `sessions`, `staff_sign_in_tokens`, `staff_sessions` —
  hashes and timestamps only, never a usable credential.
- `deletion_log` — a one-way account reference and row counts. Holds no
  personal data and survives the account.

---

## 2. Identifiers and relationships

```
accounts (id, email)
   │
   ├── professional_identities (account_id)     the person as they describe themselves
   │
   ├── scans (account_id, identity_id)          one audit run
   │      │
   │      ├── evidence (account_id, scan_id)    one row per search result
   │      ├── identity_decisions                customer's "this is me / is not me"
   │      ├── presence_snapshots                append-only score history
   │      ├── risk_snapshots                    append-only risk history
   │      └── review_decisions (account_id)     a reviewer's judgement
   │
   ├── jobs (account_id)                        payload holds the identity
   ├── sessions (account_id)
   └── audit_events (account_id, nullable)

staff (id, email, role)
   ├── staff_sign_in_tokens (staff_id)
   ├── staff_sessions (staff_id)
   ├── review_decisions (reviewer_id)
   └── review_access_log (reviewer_id, account_id, scan_id, evidence_id)

audit_attempts (requester_id, subject_key)      NOT linked to accounts
deletion_log (account_ref)                       survives deletion by design
```

**The account is the isolation boundary.** Every table holding customer data
carries `account_id`, and every repository method takes an `AccountScope`
derived server-side from the session cookie. There is no "get by id" that does
not also take an account.

The two deliberate exceptions are `review_access_log` (§6) and `audit_attempts`
(§5).

`packages/persistence/src/schema.ts`, `repository.ts`.

---

## 3. Where the data lives

- **A single SQLite file** (`node:sqlite`, WAL mode) on the machine running the
  website. In development that is `apps/website/.data/rep.db`.
- **No database has been provisioned anywhere.** No hosting has been chosen.
- **There are no backups.** Nothing replicates the file, nothing snapshots it,
  nothing ships it off the machine. A reviewer asking "what happens to deleted
  data in backups" should know the honest answer today is that there are no
  backups to answer for — and that this is a gap to close before real data, not
  a privacy feature.
- The SQL is deliberately portable (no SQLite-specific types, no
  `INSERT OR REPLACE`), so a move to Postgres is a driver change. Hosting,
  region and backup policy are open decisions.

---

## 4. The data-flow diagram

See `docs/data-flow.svg` in this directory.

In words, one audit:

1. **Request.** The customer submits the identity and the attestation.
2. **Gate, in the request.** `gate()` runs before anything else. A refused
   audit creates no job, runs no search, and records no scan — so a blocked
   request leaves no trace of that name with us beyond the attempt row.
3. **Job queued.** The audit is a background job, because a real provider
   averages minutes, not milliseconds.
4. **Search.** The provider is called. *(Today: a fixture.)*
5. **Evidence built.** Per result, in this order:
   a. identity matching, b. classification, c. clustering and deduplication,
   d. **special-category redaction** — the title and excerpt are replaced
   *before the record is created*, so the original wording never reaches the
   database. Redaction happens *after* clustering, deliberately (§9c).
6. **Scored.** Presence, risk and identity confidence computed separately.
   Written as append-only snapshots.
7. **Report.** Recomputed from evidence on read, never stored rendered.
8. **Review.** Flagged records only enter the reviewer queue.

`packages/domain/src/audit.ts`, `engine/evidence.ts`,
`apps/website/src/server/worker.ts`.

---

## 5. What the gate refuses, and the data it keeps to do so

`gate()` runs in the request and refuses before any search:

| Refusal | Condition |
|---|---|
| `purpose_not_supported` | Any purpose other than self-audit. Nothing else is implemented. |
| `attestation_missing` | No attestation text or timestamp. |
| `rate_limited` | More than **5 audits** by one requester in a rolling **24 hours**. |
| `enumeration_suspected` | More than **2 distinct names** by one requester in that window. Refused outright. |
| `verification_required` | A **second** distinct name requires a verified email address. A third requires a connected account — **and that tier is not implemented**, so it is a hard stop with no route through. |

The signal is **variety, not volume**: re-running your own name is normal,
working through a list is not.

To detect that, `audit_attempts` stores a normalised form of each name audited
against a requester id. Two properties of it matter:

- **A refusal records nothing.** The attempt is written only after every check
  passes, so a request we turned down leaves no row naming that person. A
  blocked audit costs nothing and tells us nothing we then have to hold.
- **The table is keyed on a requester id, not an account.** It has to be: its
  job is to notice one requester working through a list of different names,
  which is not a question that can be asked from inside a single account. The
  row also stores the purpose blob, which carries the attestation text and
  time.

  **This was a gap until 5 November 2026, and we would rather you saw it than
  not.** Because the table has no `account_id`, the deletion loop could not
  reach it, and the retention sweep did not cover it. The store had a
  `prune()` method with a passing test and no caller anywhere in the
  application — which reads from the outside exactly like a retention policy.
  A customer who deleted their account left their name here indefinitely.

  **Now:** attempts expire after **30 days** on the same hourly sweep as
  everything else, `deleteAccount` removes them by requester id, and one
  shared definition of that id is used by the route that writes them and the
  deletion that removes them. A test asserts the general form — every table in
  the schema is covered by deletion or by retention, or is listed with the
  reason it holds no personal data. Recorded as `OQ-28`.

`packages/domain/src/safeguards.ts`, `packages/persistence/src/attempts.ts`,
`apps/website/app/api/audit/route.ts`.

---

## 6. Who can read what

### The customer

Only their own account, through a session cookie:
`httpOnly`, `sameSite: 'lax'`, `secure` in production. The cookie holds an
opaque token; **only its hash is in the database**. The account scope is always
derived from the cookie server-side and never read from the request body.
Session lifetime **30 days**.

Sign-in is passwordless: a 6-digit code, **10-minute** expiry, single use,
stored only as a hash. The response to a code request is identical whether or
not the address has an account.

### Staff reviewers

A separate cookie over a separate table, **12 hours** rather than 30 days.

**Reviewing is the only operation that crosses the account boundary.** The
constraint is in the API shape:

- A reviewer can read **only records flagged for review**. There is no method
  that returns an account, a scan, a customer's other evidence, or a customer's
  identity. A queue item carries the evidence fields and the ids — not the
  person's name, employer or email.
- **Every read is logged**, not just every decision, against the named
  reviewer (`review_access_log`).
- A decision **without a written rationale is refused** (minimum length
  enforced in the repository).
- Decisions are append-only. A reviewer changing their mind writes a second
  row.
- **A review never edits the evidence.** It is stored as its own row and
  applied when the report is built, so the classifier's original call survives
  beside the human's.
- **Withheld material never reaches a reviewer** (§9c).

### Staff creation

`staff_sign_in_tokens` carries a `staff_id`, not an email. A code can only be
issued against an **active staff row that already exists**, so there is no path
from "knows an address" to "is staff". Staff are created out of band by a
server-side script (`npm run staff`). Disabling a staff member revokes their
sessions in the same transaction, and the session lookup requires an active
staff row anyway.

`packages/persistence/src/review.ts`, `staffAuth.ts`,
`apps/website/src/server/session.ts`, `staffSession.ts`.

---

## 7. Retention

Implemented and tested. A sweep runs **hourly**, started when the server
starts — not on a customer action, because the person who asks to be deleted
and never returns is exactly the person whose purge must still run.

| Data | Kept | Where |
|---|---|---|
| Evidence titles and excerpts | **180 days** from retrieval | `retention.ts` |
| Customer identity decisions | with the evidence they name | `retention.ts` |
| Presence and risk snapshots | **indefinitely** | not swept |
| Reviewer decisions | **730 days** | `retention.ts` |
| Reviewer access log | **730 days** | `retention.ts` |
| Finished job rows | 30 days | `retention.ts` |
| Expired/revoked sessions | 30 days | `retention.ts` |
| Consumed or expired sign-in codes | deleted on the next sweep | `retention.ts` |
| Email outbox | 30 days | `retention.ts` |
| Rate-limit attempts | 30 days | `retention.ts` |
| Deletion log | **indefinitely** (no personal data) | not swept |

Two design decisions a reviewer should weigh:

**A scan expires as a unit.** Rows are not aged out one at a time, because a
report rebuilt from whatever happened to survive would be a partial view
presented as a complete one.

**An expired scan is not an empty one.** `scans.evidence_expired_at` records
that we no longer hold what the scan found. The report branches on it and says
so, rather than rendering a well-formed report that found nothing — which is
indistinguishable from a real negative result.

**The split the policy rests on:** the excerpt is the personal data, the score
is not. A snapshot holds a number, a coverage fraction and a methodology
version. Whether that split is defensible is question 2 in the covering letter.

`packages/persistence/src/retention.ts`.

---

## 7a. Deletion

Distinct from retention, and deliberately not folded into it: retention ages
out data we are allowed to hold, deletion destroys data we were asked to
destroy.

**The flow.** A customer requests deletion in the product. The account is
scheduled for purge **30 days** later and is cancellable throughout that
window. The purge runs on the same hourly sweep, started because the server
started — the person who asks to be deleted and never comes back is exactly
the person whose purge must still run, and an earlier version that started the
worker on the first audit meant it never did.

**Requesting twice does not restart the clock.**

**A pending deletion does not set `deleted_at`.** The unique email index is
partial on that column, so marking the account deleted would free the address
immediately and a cancellation inside the grace period would then collide. A
pending deletion is a live account that has asked to stop.

**The purge is the hard deletion, not a flag.** It routes through
`deleteAccount`, so the tests for hard deletion are also the tests for what the
grace period ends in. Each account purges in its own transaction; one that
throws is left due rather than silently marked done.

**What `deleteAccount` removes**, in one transaction: identity decisions,
presence and risk snapshots, review decisions, jobs (their payload holds the
name, employer and city we searched for), evidence, scans, professional
identities, sessions, audit events, sign-in codes for the address, rate-limit
attempts for the requester, and the account row.

**Two things survive, each for a stated reason.**

- **The reviewer access log is anonymised, not deleted.** It records that a
  named member of staff read a customer's evidence, which is the accountability
  for the one operation crossing the account boundary. Destroying it with the
  evidence would erase the record of who looked at what at the moment that
  record matters most. The account id becomes a one-way reference: who read how
  much, and when, survives; whose it was does not. **Whether that exception is
  defensible is question 2 in the covering letter.**
- **The deletion log**, holding a one-way account reference, row counts and a
  timestamp. No personal data, and it exists to show a deletion happened.

**The failure mode this has already produced, twice.** Every table with an
`account_id` must be listed in `ACCOUNT_OWNED_TABLES`. A missing one is not a
leftover row: the foreign key refuses, the transaction rolls back, and the
deletion request fails with *nothing* removed. `review_decisions` and `jobs`
were each missing once, and in each case deletion was broken for every account
that had used the feature. A test now asserts the general form — every table in
the schema is reached by deletion or by retention, or is listed with the reason
it holds no personal data.

**Backups.** None exist (§3). There is no copy of a purged row anywhere,
because there is no copy of anything anywhere. This is a gap to close before
real data, not a privacy property, and the backup policy chosen later will need
a deletion story of its own.

`packages/persistence/src/repository.ts` → `requestDeletion`,
`cancelDeletion`, `deleteAccount`, `purgeDueAccounts`.

---

## 8. What leaves the system

**Nothing is transmitted to any third party.** There are no outbound network
calls anywhere in the codebase. Every `fetch` in the application is
same-origin, from the browser to our own API routes. The only third-party
runtime dependencies in the whole project are Next.js and React, both in the
website; the domain and persistence packages have none.

Three ways data leaves:

### Export
`GET /api/account/export` returns everything held for the account as JSON:
identities, scans, evidence, decisions, snapshots and audit events. The
**first key in the file** is the permitted-use statement, before anything about
the person — an export is the copy most likely to be forwarded and the least
likely to arrive with context.

Two redactions in the customer's own export: an audit event whose actor is a
named reviewer is reduced to `reviewer`, and a review decision's reviewer id is
dropped. The customer is entitled to know a reviewer acted, not which one.

### Print
The report prints from the browser. The full evidence register is forced
visible in print — whichever view the reader left on screen — so a printed
copy cannot be a score without its evidence, and collapsed sections are forced
open. The permitted-use statement prints with the report; a test asserts the
print stylesheet does not hide the element carrying it, since that is the
sentence most easily lost to a rule that hides notices to save a page.

### Email
`email_outbox` is a table, not a provider. **Nothing is actually sent.** The
deliverer writes the message to the table and to the console with an explicit
`NOT SENT — no mail provider configured` line. There is a development endpoint
that reads the latest sign-in code out of that table, guarded twice: the build
must not be production **and** the configured deliverer must not really send
mail. Wiring in a real provider closes it automatically, with nothing to
remember to delete.

`packages/persistence/src/repository.ts` → `exportAccount`,
`packages/persistence/src/email.ts`,
`apps/website/app/api/auth/outbox/route.ts`.

---

## 9. Known limitations, stated plainly

### 9a. Identity matching is probabilistic

A name match is not an identity match. Confidence is accumulated from named
signals (own declared domain, employer, city, profession, credentials) and
banded: **confirmed ≥ 0.85, probable ≥ 0.6, uncertain ≥ 0.3**, below that
rejected. A result on the customer's own declared domain short-circuits to
near-certainty, because they told us it is theirs.

Anything uncertain is **excluded from the score** and handed back to the
customer to confirm or reject. The aggregate identity confidence is a *share*
(how much of what bears the name is attributable) times a *quality* (how strong
those attributions are), so one confident match among five contradictions reads
low, not high. This was corrected in `OQ-24`; the previous metric could not
fall when results were rejected.

**What this does not solve:** two professionals with the same name in the same
city and profession. The system reports low confidence and asks. It does not
resolve them.

### 9b. Provenance is declared, not detected

`created_by`, `distribution` and `editorial_independence` record who wrote a
result and how it reached where it sits. Content we wrote, content the customer
wrote, and paid or syndicated placement are excluded from the source-authority
credit, so the engine cannot credit its own work. Verified end-to-end:
declaring a placement **lowers** the score.

**The open gap (`OQ-25`):** a customer's own words published on a third-party
domain — a founder's bylined column, a guest post — are indistinguishable from
independent coverage unless somebody declares them. Today the undeclared
default is third-party and editorial, so such material is credited as
independent. The intended fix is to ask the customer at the point of review
rather than to infer it from keywords, and to classify as **unknown** where
independence cannot be established — counted as an observed result, but earning
no independent-authority credit. **Not yet implemented.**

### 9c. Special-category detection is term-based, and deliberately blunt

Where a result appears to touch health, religion, political opinion, sexual
orientation, racial or ethnic origin, trade union membership or immigration
status, the **title and excerpt are discarded before the record is created**.
The URL, source, date and position remain. The report states that it was done.

Three design decisions:

- **The matched word is never stored.** `sensitivity_signals` holds pattern
  names, because "HIV" sitting in a signal field is the datum itself, in the
  column designed to be safe to log.
- **Redaction happens after clustering.** Every withheld record carries
  identical placeholder text, so redacting first would make the clusterer read
  unrelated results as reprints of one another — and a cluster is what promotes
  an allegation to a finding.
- **An official record is never withheld.** A disbarment that mentions a health
  condition is still a disbarment. `OQ-19` holds the case this does not settle.

Withheld material never reaches the risk assessment and never reaches a
reviewer — queueing it would send a member of staff to the source to read it.

**What this does not solve:** term matching has both false positives and false
negatives, and it operates on the provider's snippet, not the page.

### 9d. The worker is single-process

It dies with the server. Adequate against a fixture and a local file;
inadequate once either changes. A deploy mid-audit loses the run, and nothing
coordinates across machines. Stalled jobs are returned to the queue after 10
minutes.

### 9e. The attempt store

`gate()` is written against a storage seam. The durable SQLite implementation
exists and is what the site uses; an in-memory implementation also exists for
tests. A multi-instance deployment needs the durable one in a shared database —
a per-instance counter would not bound anything.

---

## 10. Third-party services

**None are in use.**

| Need | Status |
|---|---|
| Search provider | **Not chosen, not connected.** See `docs/SEARCH_PROVIDERS.md`. |
| Mail provider | Not connected. `OQ-14`. |
| Hosting | Not chosen. |
| Database | SQLite file, local. No managed database provisioned. |
| Payments | Not built. No payment processor, no card data. |
| AI / classification | **No AI provider is connected.** Classification is deterministic code in `packages/domain`, not a model call. |
| Analytics, tag managers, session recording | None. |
| Error reporting | None. |

The website loads one external resource: Google Fonts, via `next/font`, which
self-hosts the font files at build time.

Each of these becomes a processor relationship when chosen, which is why
question 6 in the covering letter asks which answers are specific to today's
shape.

---

## 11. What the customer authorizes, and what the product will not do

**Authorized by the customer, explicitly, per audit:** that the audit is about
them, in the stored words of the attestation.

**Refused in code, not in policy:**

- Any purpose other than self-audit. The gate refuses before searching.
- Looking up a third name from one requester. No route through; the escalation
  tier is deliberately unimplemented.
- A review decision with no written rationale.
- A reviewer reading anything not flagged.
- A report rendered from expired evidence as though it were complete.
- A score adjusted to influence renewal. Scoring takes no commercial input.

**Absent by design, not merely unbuilt:** employment screening, tenant
screening, credit assessment, insurance eligibility, or any other eligibility
use. There is no feature, field or flag for a report about someone other than
the requester, or for delivery to a third party.

The permitted-use statement is a single definition in the domain
(`PERMITTED_USE`), rendered first in the report's limitations, printed with the
report, and carried as the first key of every export. Tests assert each of
those.

---

## 12. Where to look in the code

| Subject | File |
|---|---|
| Schema, every table | `packages/persistence/src/schema.ts` |
| Account scoping, export, hard deletion | `packages/persistence/src/repository.ts` |
| Retention sweep | `packages/persistence/src/retention.ts` |
| Reviewer access and logging | `packages/persistence/src/review.ts` |
| Customer / staff authentication | `packages/persistence/src/auth.ts`, `staffAuth.ts` |
| The gate | `packages/domain/src/safeguards.ts` |
| Identity matching | `packages/domain/src/engine/identity.ts`, `confidence.ts` |
| Special categories | `packages/domain/src/engine/sensitive.ts`, `evidence.ts` |
| Permitted use | `packages/domain/src/contracts/types.ts` |
| Open questions | `docs/OPEN_QUESTIONS.md` |

At the time of writing the test suite passes; the numbers above were read from
the source, not from the tests.
