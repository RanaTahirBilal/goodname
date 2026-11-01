# Evidence Model

Evidence is a product feature, not an implementation detail. At these prices a
customer is entitled to ask "why are you telling me this?" and get an answer
that holds up.

**Every material finding traces to an evidence record.** A claim that cannot
be traced does not reach a customer.

---

## The record

`EvidenceRecord` in `packages/domain/src/contracts/types.ts`.

| Field | Purpose |
|---|---|
| `id` | Stable within a scan; findings and recommendations reference it |
| `sourceUrl`, `sourceName`, `domain` | Where it came from |
| `retrievedAt` | When *we* observed it |
| `publishedAt` | When the source published it, where determinable |
| `title`, `excerpt` | Verbatim from the provider — never paraphrased |
| `position` | Rank in the observed window |
| `provenance` | `live_search` · `fixture` · `customer_supplied` · `connected_account` |
| `providerName` | Which provider returned it |
| `identityConfidence`, `identityStatus`, `identitySignals` | Is this the right person, and what corroborated |
| `sourceReliability`, `authority` | How much weight the source carries |
| `classification`, `classificationConfidence`, `classificationRationale` | What it is, and why we think so |
| `findingStatus`, `severity`, `severityRationale` | How settled a negative claim is |
| `reviewStatus` | `auto` · `needs_human_review` · `customer_confirmed` · `customer_rejected` |
| `contradictedBy`, `correctionOf` | Links to evidence that disputes or corrects it |
| `storyClusterId`, `duplicateOf`, `independentSourcesInCluster` | Which story it belongs to, and whether it is a reprint |

---

## Excerpts are verbatim

We carry the provider's snippet unchanged. We do not summarise a source into
a claim, because a summary of an allegation reads like a finding — "reports
say he was accused" becomes "he was accused" the moment it is compressed.

This also means excerpts are untrusted text. They are displayed as quotations
and never interpreted as instructions.

---

## Provenance travels

`provenance` is set on every record and surfaces as `containsFixtureData` on
the presence score and the risk assessment, and `isFixture` on the scan.

The flag lives in the data rather than only in the interface deliberately. A
banner on a screen is lost the first time someone screenshots a report or
exports a PDF; a field on a record survives.

**We never present fixture results as live.**

---

## Story clustering

One event produces many articles. Counting each as independent would make
syndication look like corroboration, which is backwards — a wire story in
eight outlets is one newsroom's work reprinted.

- Similarity ≥ **0.5** (Jaccard over significant tokens): same story, one cluster
- Similarity ≥ **0.8**: same text, a reprint — marked `duplicateOf`

`independentSourcesInCluster` counts distinct domains **excluding reprints**.
That is the number that may promote an allegation to a finding, and it is
computed once during clustering. Recomputing it later by counting domains
would reintroduce exactly the bug clustering exists to prevent.

The earliest-published member is the cluster primary — a reprint cannot
predate its source.

---

## Corrections and contradictions

A result carrying `correctsUrl` links to what it supersedes. The superseded
record's `findingStatus` becomes `corrected` or `retracted`, and both are sent
to human review.

Within a cluster, a claim contradicted by a correction or retraction is
re-marked `disputed`.

A retracted claim **leaves the risk level but stays in the report**. Dropping
it silently would hide the correction as well, and the correction is often the
thing the customer most wants to point at.

---

## Review status

Flagged `needs_human_review` automatically when:

- identity status is `probable` or `uncertain` — we are not certain it is them
- finding status is `confirmed_finding`, `allegation` or `disputed` — it could
  damage someone

Anything that could harm a person, and anything we are unsure is that person,
goes in front of a human before it is treated as settled.

**The flag is set but nothing consumes it yet.** A review queue is required
before findings are shown to paying customers. See `SAFEGUARDS.md`.

---

## Distinct states

Never collapsed into one another:

| State | Meaning |
|---|---|
| `provider_error` | The search failed. **No report is produced.** |
| `rate_limited` | The provider throttled us; retry hint included |
| `ok` with no results | We searched and genuinely found nothing |
| `partial` | Coverage was incomplete; the report says so |
| `insufficient_evidence` | We found things but not enough to score |

A failed provider call must never render as an empty but complete report.

---

## Never fabricated

Sources, citations, findings, credentials, achievements, awards, publications,
memberships and client results are never invented. Where a claim needs
confirming, the report says so and asks.
