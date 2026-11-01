# Self-Audit Safeguards

**These are engineering controls. They do not establish legal compliance.**
Qualified legal review is required before public launch. See §Open questions.

---

## The problem

The product is for professionals auditing *their own* online presence.
Nothing in a search pipeline enforces that: a name is a name. Without
deliberate safeguards, a free audit form is a people-search engine with better
typography.

The constraint is proportionality. Too weak and the product is misused. Too
heavy and nobody completes a free audit, which is the entire acquisition path.

**A checkbox does not establish authorization.** It establishes that we asked,
which matters for the record and not at all for prevention. So attestation is
the floor, not the mechanism.

---

## Implemented

In `packages/domain/src/safeguards.ts`, with 10 tests.

### 1. Purpose confirmation

`AuditPurpose` is a required input. Only `self_audit` is supported; any other
purpose is refused before the provider is called. The exact attestation text
shown to the customer is stored on the record, so the audit carries the words
they actually agreed to rather than a boolean.

### 2. Rate limiting on variety, not volume

The signal that separates a professional checking themselves from someone
working through a list is **not how many audits, but how many different
names**.

| Control | Default |
|---|---|
| Audits per requester per day | 5 |
| Distinct subject names per day | 2 |

Re-running your own audit is normal and is not throttled early. Name variants
("Jensen Adoni", "jensen adoni") normalise to one subject, so people are not
penalised for typing their own name differently.

### 3. Escalating verification

| Distinct names | Required | Status |
|---|---|---|
| 1 | None beyond attestation | Implemented |
| 2 | Verified email | **Implemented** — a verified session sets `verification: 'verified_email'` |
| 3+ | Connected professional account | Not implemented; a third name is refused outright |

Verified end to end: an anonymous visitor runs one audit, is refused a second
different name with `verification_required`, signs in, and is then allowed.
Re-running their *own* name is never throttled at this step — variety is the
signal, not volume.

### 4. Enumeration detection

Beyond the distinct-subject limit, audits are paused pending review rather
than merely slowed.

### 5. Gate before provider

The gate runs **before** any search. A blocked request costs nothing and
leaves no search for that name in any log — including ours.

---

## Not implemented

| Gap | Why it matters | Needed before |
|---|---|---|
| ~~Durable attempt store~~ | **Closed.** `SqliteAttemptStore` in `@rep/persistence`, with tests exercising the gate across a restart. Still single-machine: several instances would each keep their own counts. | — |
| ~~Real authentication~~ | **Closed.** Passwordless email sign-in: single-use codes, hashed at rest, sessions as revocable rows. A verified address now drives `verification: 'verified_email'`. | — |
| Email delivery | No mail provider is configured, so no code can actually reach anyone. A dev-only endpoint exposes codes and is guarded on build mode **and** on the deliverer not really sending. | Public launch |
| `connected_account` tier | The third escalation step has no implementation, so a third distinct name cannot be unblocked at all. | Scaling past two subjects |
| Identity verification | No mechanism exists to verify a verified email or connected account | Public launch |
| ~~Retention policy~~ | **Closed, pending legal.** Evidence excerpts expire 180 days after retrieval, a scan expires as a unit, and the worker sweeps hourly. Score history survives the excerpts; the reviewer access log outlives both. Periods are defensible defaults, not legal advice — OQ-6. | — |
| ~~Audit logging~~ | **Closed.** `audit_events` records actor, action and subject for account creation, scans, decisions and exports — and deliberately holds no evidence payloads. | — |
| Sensitive-data handling | No classification or special handling of sensitive attributes found in results | Storing real customer data |
| ~~Human review queue~~ | **Closed.** `/review` consumes the flag. A reviewer sees flagged records only, every read is logged against them, and a decision without a written reason is refused. | — |
| ~~Staff authentication~~ | **Closed.** Reviewers sign in passwordless with their own address against their own staff row. Verifying a code never creates staff, so there is no self-service path into the queue; sessions last 12 hours and die when the reviewer is disabled. | — |

---

## Data minimisation

**Not collected by default:** government identity documents, date of birth,
home address, national identifiers. The identity model asks only for what
improves search accuracy — name, profession, employer, city, region,
credentials, website.

Document verification exists in the `VerificationLevel` type as the highest
tier, and is deliberately not reachable by the current escalation path.
Collecting identity documents to run a reputation audit is disproportionate to
the risk being managed.

**Found but not sought:** broker listings surface home addresses, phone
numbers and relatives. These appear in evidence because they are the exposure
being reported. They need a retention policy and a deletion path before any
of it is stored.

---

## Scope limits

Deliberately absent, and not to be added without a separate decision:

- employment screening
- credit assessment
- insurance eligibility
- tenant screening
- any other high-impact eligibility decision

These are regulated uses with obligations this product does not meet. The
absence is the safeguard.

---

## Untrusted content

Search results and any third-party web content are untrusted input.
Instructions embedded in a retrieved page never change system behaviour,
reveal configuration or authorise an action. Evidence excerpts are carried
verbatim and are never interpreted as instructions, and never paraphrased
into a claim — a summary of an allegation reads like a finding.

---

## Open questions for legal review

1. **Does self-lookup framing resolve FCRA exposure?** The product is not sold
   for eligibility decisions, but customers could use a report that way. What
   contractual and technical controls are expected?
2. **State privacy law.** What obligations attach to holding search evidence
   about an identified individual, including the sensitive attributes broker
   listings expose?
3. **Professional advertising rules.** Attorney and physician advertising is
   separately regulated in most states. What constraints apply to the reports
   and the marketing?
4. **Allegation handling.** Where a report accurately says a source alleges
   something, what is the exposure if that source is wrong? Does surfacing an
   allegation, labelled as such, carry republication risk?
5. **Correction and removal workflows.** Drafting correction requests on a
   customer's behalf may touch unauthorised practice of law in some states.
6. **Retention.** How long may evidence be held, and what must deletion
   actually remove?

**Do not launch publicly until 1, 2 and 6 are answered.**
