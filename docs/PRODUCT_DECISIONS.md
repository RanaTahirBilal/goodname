# Product Decisions

A running log of decisions, each with the reasoning and what would reverse it.
Entries are append-only. When a decision changes, add a new entry superseding
the old one rather than editing history.

---

## PD-001 — npm workspaces, not pnpm + Turborepo

**Date:** 2026-10-29
**Status:** Accepted (provisional)

The brief prefers pnpm workspaces and Turborepo "if supported by the project
environment". They are not: neither is installed, and the machine has npm
11.20.0 with Node 26.12.1.

npm workspaces ships with the Node already present, needs no install, and gives
us the workspace layout today. Turborepo is a caching task runner — it is worth
adding when build times justify it, and adding it later does not change the
directory structure or the package boundaries.

**Reverses if:** builds get slow enough that remote caching pays for itself, or
the team standardises on pnpm for lockfile reasons.

---

## PD-007 — Presence, risk and confidence are three outputs, not one score

**Date:** 2026-10-29
**Status:** Accepted — supersedes PD-002

PD-002 kept risk as a dimension inside the composite and added harm caps so a
severe finding could not be averaged away. The instinct was right; the
mechanism was not.

A cap compresses an event into a bound. A customer reading "40, capped" learns
their ceiling — not that an Illinois court disbarred them, not that it ranks
second, not that nothing else about their presence is wrong. And the inverse
is worse: a weak presence already scoring 38 shows no cap at all, so the same
finding becomes invisible in exactly the case where it matters most.

The audit now returns three outputs:

- **A. Online Presence Score** — 0–100 across D, P, A, H, C. No risk dimension.
- **B. Reputation Risk Assessment** — a level plus traceable findings, with no
  aggregate number at all.
- **C. Confidence** — identity confidence and evidence coverage, separately,
  because they have different remedies.

Separating them removes the problem rather than bounding it. A person can have
a presence score of 71 *and* a severe risk finding, which is a common
situation and an unrepresentable one in a single aggregate.

Caps are gone. There is a test asserting they do not come back.

**Reverses if:** a customer-facing reason emerges to express overall standing
as one number — in which case it should be a presentation-layer composition
with both inputs visible, never a re-merge of the models.

---

## PD-002 — Scoring model reconciles with the existing engine spec rather than replacing it

**Date:** 2026-10-29
**Status:** Superseded by PD-007

The brief proposes five dimensions: Search Discoverability, Professional Profile
Completeness, Source Authority and Relevance, Information Consistency, Digital
Asset Health.

All five measure **presence quality**. None can represent **harmful content**.

This matters for the stated audience. For an attorney or a physician, one
damaging result at position one is the reputation problem. Under the proposed
model that person scores well: they are discoverable, their profiles are
complete, the sources are authoritative, the information is consistent, and
their website is healthy. The score would be confidently wrong in the exact
case the customer is paying to solve.

`scan-score-engine-spec.md`, already in this repository, has two dimensions the
proposal drops — Sentiment & Risk, and Privacy Exposure — with worked formulas
for prominence weighting, severity, authority and recency decay. It also already
does the things the brief asks for in section 5: weight renormalisation when a
dimension does not apply, frozen weights per major version, and stored
methodology versions.

The proposal is therefore not an upgrade. The recommendation is to keep the
existing engine's structure and fold the brief's dimensions into it. See
`SCORING_SPEC.md` for the reconciled model.

**Guardrail kept from the brief:** negative content is not automatically a
penalty. Legitimate criticism is a legitimate search result. The Risk dimension
scores *substantiated reputational harm* — severity × prominence × authority ×
recency — not "an opinion we dislike".

**Reverses if:** you decide the product should only ever describe presence and
never characterise content, in which case the Risk dimension comes out and the
report says plainly that it does not assess harm.

---

## PD-003 — The first slice runs without Supabase

**Date:** 2026-10-29
**Status:** Accepted

No Supabase CLI, no project, no credentials. Rather than block, the domain
logic (normalisation, identity matching, scoring) is written as pure functions
with no persistence dependency, and storage sits behind a repository interface
with an in-memory implementation.

This keeps the engine genuinely testable now, and makes Postgres an adapter
rather than a rewrite.

**Reverses if:** nothing — this is the right shape regardless. The in-memory
implementation gets replaced, the interface does not.

---

## PD-004 — Fixture search data is labelled in the data, not just the UI

**Date:** 2026-10-29
**Status:** Accepted

No search provider credentials exist. The fixture provider is not a stub that
returns plausible rows; every result it returns carries `provider: 'fixture'`
and `isFixture: true` through normalisation, scoring and into the report
payload.

A label that lives only in the interface gets lost the first time someone
screenshots a report or exports a PDF. A label in the record survives.

**Reverses if:** never. Real providers simply set `isFixture: false`.

---

## PD-005 — The existing mobile app is paused, not extended

**Date:** 2026-10-29
**Status:** Proposed — needs sign-off

`goodname-app` has 35 routes, a themed design system and a contrast test. It
was built for a different customer: a consumer or small business managing
reviews, locations and data brokers.

The new audience is attorneys, physicians, founders and executives paying
$750–$5,000 a month. Review inboxes, location comparison and broker removal are
not what they buy. The revenue path is audit → report → managed workflow, and
that path is on the web.

Concretely worth harvesting: `src/theme` (tokens plus the contrast test),
`src/api` contracts, and the design system in `design/ui`. Concretely out of
scope for now: the business-mode screens, the broker flows.

**Reverses if:** you want a mobile companion earlier than Phase 8 — but it
should be a reader of the web product, not a second implementation of it.

---

## PD-006 — No commercial name, no domain, no branding

**Date:** 2026-10-29
**Status:** Accepted

Internal name `Reputation Platform` only. Branding is a single configuration
value so the final name is a one-line change.
