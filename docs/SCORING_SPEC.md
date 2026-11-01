# Scoring Specification — Reconciliation

**Status: provisional.** These weights, thresholds and levels are reasoned,
not empirically validated. Nothing in this document may be presented to a
customer, in marketing or in a report, as scientifically validated.

- Presence methodology version: `3.0.0-provisional`
- Risk methodology version: `1.0.0-provisional`

---

## 0. The reconciliation

Three scoring approaches existed in this repository and had to be resolved.

| Source | Proposed | What it got right | Why it was not kept as-is |
|---|---|---|---|
| `scan-score-engine-spec.md` | 6 sub-scores including Sentiment & Risk and Privacy Exposure, single composite | Worked penalty formulas; renormalisation; frozen versions | Folded harm into one aggregate |
| The platform brief | 5 presence dimensions, single composite | Clean separation of presence factors | Could not represent harm at all |
| First implementation (v2) | 7 dimensions including Risk, plus harm caps | Harm could not be averaged away | A cap is lossy — it reports a ceiling, not an event |

**The resolution: stop aggregating things that are not alike.**

The audit now produces **three separate outputs**:

| | Output | Shape | Why |
|---|---|---|---|
| **A** | Online Presence Score | 0–100 | Presence quality genuinely is aggregate |
| **B** | Reputation Risk Assessment | Level + findings | Harm is specific; a number destroys the detail |
| **C** | Confidence | Two measures | Identity doubt and coverage gaps have different fixes |

### Why caps were the wrong answer

The previous version kept Risk as a dimension and added caps — "a severity-5
result at position 2 caps the score at 40". It stopped a severe finding being
averaged away, which was the right instinct.

But a cap compresses an event into a bound. A customer reading "40, capped"
learns their ceiling; they do not learn that an Illinois court disbarred them,
that it ranks second, or that nothing else about their presence is wrong. And
the inverse case is worse: a weak presence that already scores 38 shows no cap
at all, so the same finding becomes invisible.

Separating the outputs removes the problem rather than bounding it. A person
can now have a presence score of 71 *and* a severe risk finding, which is both
a common situation and one no single number can express.

---

## A. Online Presence Score

Measures how well established a professional online presence is. **Contains no
risk dimension.**

| Code | Dimension | Weight |
|---|---|---:|
| `D` | Discoverability & Ownership | 0.30 |
| `P` | Professional Profile Completeness | 0.24 |
| `A` | Source Authority & Relevance | 0.20 |
| `H` | Digital Asset Health | 0.14 |
| `C` | Information Consistency | 0.12 |

Weights sum to 1.00 and are frozen per major version.

Every report states: *this is not a measure of your reputation, character or
competence, and negative content is assessed separately.*

### Shared functions

```
prominence(position) = 1 / log2(position + 1)
```
Position 1 → 1.000, 3 → 0.500, 10 → 0.289. Unranked contributes nothing, which
differs from contributing zero to an average.

```
recency_decay(age_days) = 0.5 + 0.5 × exp(-age_days / 1095)
```
Three-year half-life, floored at 0.5. An undated item gets 0.75 and is flagged
rather than being treated as fresh or ancient.

**Authority** derives from source reliability: official 1.0, high 0.8,
moderate 0.55, low 0.2, unknown 0.3. It is a property of the publication,
never of whether we like what it says — the same tier applies to praise and
to criticism.

### Dimensions

**D — Discoverability & Ownership**
```
owned_share = Σ prominence(owned) / Σ prominence(all attributed)
D = clamp(0.55·owned_share + 0.35·(ranked ? 1 : 0.3) + (rich_entity ? 0.15 : 0))
```

**P — Professional Profile Completeness**
```
coverage     = profiles found / profiles expected for the vertical
completeness = mean fraction of {photo, bio ≥ 40 words, credentials, link}
P = 0.5·coverage + 0.5·completeness
```
The expected set is per-profession configuration, not code.

**A — Source Authority & Relevance**
```
A = clamp(Σ (authority × recency_decay) over earned coverage / 3.0)
```
Caps at roughly three solid recent mentions. Not scaling past that is
deliberate: it must not reward press-release spam.

**H — Digital Asset Health** — mean of normalised website checks. Inapplicable
with no connected site.

**C — Information Consistency**
```
C = clamp(agreement − 0.5·stale_share)
```
Inapplicable below two comparable profiles: one profile always agrees with
itself.

### Duplicate handling

Syndicated reprints are excluded before scoring. One wire story in eight
outlets is one piece of coverage. See §Evidence.

### Missing data and renormalisation

Missing data is never 0 and never 100.

```
coverage = Σ weight(i) for applicable i
score    = round(100 × Σ weight(i)·value(i) / coverage)
```

`coverage` is reported to the customer as a percentage.

**Minimum evidence:** below `coverage = 0.55` no score is returned. The result
is `insufficient_evidence` with the missing dimensions and what would help.
We do not manufacture a number to fill a gauge.

Note `D + P = 0.54`, just under the threshold: discoverability and profiles
alone cannot produce a score.

---

## B. Reputation Risk Assessment

**Produces no aggregate number, by design.** A level, plus the findings behind
it, each traceable to evidence.

### Levels

`none` · `low` · `elevated` · `high` · `severe`

### Finding status — the distinction that matters most

| Status | Meaning | Affects level |
|---|---|---|
| `confirmed_finding` | Official record, or ≥2 independent reliable sources | Yes |
| `allegation` | Asserted, not adjudicated | Yes, lower |
| `disputed` | Contradicted by another source we hold | Yes, lowest |
| `corrected` | The source published a correction | No — shown, sent to review |
| `retracted` | The source withdrew it | No — shown, sent to review |
| `opinion` | Criticism, not a factual claim | No — listed as commentary |
| `unverified` | We cannot tell | No — excluded, flagged |

**An allegation is never reported as a finding.** "Accused of fraud" and
"convicted of fraud" describe very different situations, and conflating them
turns a reputation tool into a defamation engine.

Promotion from `allegation` to `confirmed_finding` requires:
- an official source (court, regulator, licensing board), **or**
- ≥2 *independent* sources, all high reliability, none contradicting

### Syndication is not corroboration

Independence is counted per domain within a story cluster, **excluding
near-identical reprints**. Clustering uses Jaccard similarity over significant
tokens: ≥0.5 is the same story, ≥0.8 is the same text.

Getting this threshold wrong is consequential both ways. Too low and one press
release promotes an allegation to a finding; too high and genuine corroboration
never registers.

### Level derivation

| Condition | Level |
|---|---|
| confirmed finding, severity 5 | `severe` |
| confirmed finding, severity 4 | `high` |
| confirmed finding, severity 3, prominent (top ~3) | `high` |
| any other confirmed finding | `elevated` |
| allegation, severity ≥ 4 | `elevated` |
| any other allegation, or a disputed claim | `low` |
| nothing | `none` |

The overall level is the highest that applies. High privacy exposure
contributes at `elevated`.

**Age relief:** a finding that is both old (recency weight ≤ 0.56, roughly a
decade) and buried (prominence < 0.35, outside the top ~6) drops one level,
never below `low`. **Severe never receives relief** — a conviction on page one
of someone's name is not improved by being from 2014.

### What is deliberately not penalised

- **Legitimate criticism.** Reported as commentary, never as harm.
- **Negative but accurate coverage.** Accuracy is not our judgement to make
  against a reliable source.
- **Retracted and corrected claims.** Removed from the level, still shown —
  dropping them silently would hide the correction too.

### Privacy exposure

Assessed separately from reputational findings.

| Listings | Level |
|---|---|
| 0 | `none` |
| 1–2 | `low` |
| 3–5 | `elevated` |
| 6+ | `high` |

When no broker assessment has run, the report says so rather than claiming
zero exposure.

---

## C. Confidence

Two measures, kept apart because they have different remedies.

### Identity confidence

| Range | Status | Treatment |
|---|---|---|
| ≥ 0.85 | `confirmed` | Counts fully |
| 0.60–0.85 | `probable` | Counts, flagged for confirmation |
| 0.30–0.60 | `uncertain` | Excluded; shown for the customer to confirm or reject |
| < 0.30 | `rejected` | Excluded |

Signals are additive and recorded in words: full name 0.35, alias 0.30,
surname alone 0.10, employer 0.25, city 0.15, region 0.12, credential 0.15,
profession language 0.10. The customer's own declared domain short-circuits
to 0.98.

**A result that does not name the person is rejected outright**, whatever else
corroborates. Employer, city and credentials cannot rescue it.

**Employer-name collisions.** Names are matched against text with the employer
removed, and with separators flattened so a URL slug (`/adoni-law-sanctioned`)
cannot smuggle the firm name back in. Professionals are routinely named after
their own firms; without this, "Adoni Law sanctioned over discovery failures"
reads as being about Jensen Adoni.

Overall confidence is prominence-weighted over **every** record bearing the
name, including rejected ones. Averaging only records that passed the bar
would make the number structurally incapable of falling below the `probable`
threshold, and the low-confidence flag would never fire.

### Evidence coverage

The share of the presence model we could evaluate. Reported as a percentage.

---

## Versioning

Every snapshot stores: both methodology versions, the weights as applied, each
dimension score and applicability, coverage, identity confidence, every
finding with its status and evidence, and the evidence records themselves.

When a methodology changes, the version increments and comparison across the
boundary is labelled as not directly equivalent. History may be recomputed
under the new version for comparison; a past score is never silently restated.

**Scores are never adjusted to influence renewal.** A hard rule.

---

## Test coverage

90 tests. The adversarial set covers:

- ambiguous identity — a different person with the same name
- false matches — results that never name the person
- employer-name collisions — firm news attributed to the individual
- duplicate stories — one wire story in three outlets
- genuine corroboration — two independently written accounts
- allegations versus confirmed findings
- retractions and corrections
- contradictory sources
- insufficient evidence
- provider failure versus empty results
- criticism not scored as harm
- recommendations that promise nothing
