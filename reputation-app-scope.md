# Reputation App — Product Teardown & Build Scope
*Senior PM read of the "goodname." Lovable prototype + the repu / repRenew / repRevive brand boards*
Date: 2026-10-27

---

## 1. What the prototype actually is

A 67-second screen recording of a **Lovable.dev web prototype** called **goodname.** — "Your reputation. Your future. / Build it. Improve it. Protect it."

It has exactly **two tabs**: `Score` and `Improve`. That's the whole app today.

**Score tab**
- Toggle: `Individual` / `Business`
- Input: Full name (required) + optional city, industry, job title, website
- CTA: "Check my score" → "Checking your reputation…" (~8s)
- Disclaimer in the UI: *"AI estimate based on what the model knows. Live web scanning coming soon."*
- Output: a donut gauge — **55 / Fair**, labeled "Reputation Health Score · 10/22/2026"
- "Your online presence" narrative paragraph
- Five sub-scores, each with a reason line: **Search Results** (Visibility Unverified), **News & Press** (Coverage Unverified), **Reviews** (Feedback Unverified), **Social Media** (Activity Unverified), and a fifth below the fold
- "Your improvement plan" — 5 prioritized actions with High/Medium chips:
  1. Create an authoritative biography (High)
  2. Connect verified profiles (High)
  3. Seek relevant coverage (Medium)
  4. Collect authentic feedback (Medium)
  5. Monitor name mentions (Medium)
- CTA: "Start improving →"

**Improve tab** — "Build positive results. Fresh, truthful content pushes the best of you to the top of search results."
- Content type picker: `Online bio` · `Press release` · `Profile summary` · `Review reply`
- Subject toggle: Individual / Business
- Name field + context field ("Key facts: role, achievements, news, mission, location…" or "Paste the review here…")
- Tone picker: `Professional` · `Warm` · `Bold`
- CTA: Generate → "Your draft" → *"Pick a type, add a few facts, and we'll write it for you. Then publish it on your website, LinkedIn, Google profile…"*

**The honest verdict:** right now this is a **single LLM call with a nice gauge on it**. The score is the model guessing from training data — it literally says "I cannot confirm which search results belong to Jensen Adoni." There is no crawl, no index, no account, no persistence, no monitoring, no publishing. That is fine for a demo and fatal as a product. Everything below is about closing that gap.

---

## 2. The brand boards (repu / repRenew / repRevive)

Three positionings of the same engine, all sharing a 4-pillar spine:

| | repu. | repRenew | repRevive |
|---|---|---|---|
| Promise | "Your reputation, in your hands." | "A better tomorrow, online." | "A brighter you, online." |
| Pillars | Scan · Score · Improve · Protect | Assess · Improve · Renew · Maintain | Restore · Rebuild · Revive · Protect |
| Personality | Simple, friendly, empowering | Positive, action-oriented | Reassuring, transformational |
| Target | Mass-market, "Credit Karma for reputation" | Ongoing improvers | People with a real problem |
| Score shown | 78 Good | 82 Great | 76 Good |

The third mock (`rep.` dark) breaks it into **rep.scan / rep.renew / rep.repair / rep.protect** — note **repair** appears there but not in the goodname prototype.

**PM call:** don't ship three brands. Ship **one brand with repu/goodname's mass-market framing** and treat "revive/repair" as a *mode* the product enters when the scan finds negative items. Credit Karma didn't launch a separate brand for people with bad credit. The hopeful framing gets you top-of-funnel volume; the repair framing is where the money is, and the score is what routes people between them.

---

## 3. Jobs to be done & segments

| Segment | Job | Willingness to pay | Volume |
|---|---|---|---|
| **Anxious professional** | "What does a recruiter/date/client see when they Google me?" | Low ($0–10/mo) | Very high |
| **Job seeker / grad** | "Make the first page of my name look credible" | Low–Mid | High |
| **Person with a problem** (mugshot, old article, bad review, name confusion) | "Get this off page one" | **Very high ($300–5,000)** | Low–Mid |
| **Local SMB / solo practitioner** (dentist, realtor, lawyer, restaurant) | "Manage Google reviews and rank well" | Mid ($50–300/mo) | High |
| **Executive / public figure** | "Control the narrative, monitor mentions" | High | Low |

The prototype's Individual/Business toggle already acknowledges the consumer/SMB split. **Decide which one you're building for first** — the SMB product is review-platform integrations (Google Business Profile, Yelp, Trustpilot) and the consumer product is search-results management. They share a score and a content engine but almost nothing else in the backend. My recommendation: **consumer-first, free scan as the wedge**, SMB as a fast-follow because it monetizes faster and the Google Business Profile API is a well-trodden path.

---

## 4. Scope — what has to be built

### 4.1 Scan (does not exist yet; this is the product)
The score has to come from **real observed data**, not the model's memory. Minimum viable scan:

- **Identity resolution.** Name + city + industry + employer → disambiguate "which Jensen Adoni." This is the hardest and most under-appreciated problem. Expect to ship a "is this you?" confirmation step over the top ~20 results.
- **SERP capture.** Top 10–20 Google results for `"Name"`, `"Name" + city`, `"Name" + employer`. Buy this (SerpAPI, Bright Data, DataForSEO, Oxylabs) — do not scrape Google yourself.
- **Classification per result.** Owned / earned / neutral / negative / not-you. LLM classifier with a confidence score and human-readable reason.
- **Profile discovery.** LinkedIn, X, Instagram, Facebook, YouTube, GitHub, Crunchbase, company bio pages.
- **Review aggregation** (business mode): Google, Yelp, Trustpilot, G2, Healthgrades/Avvo by vertical.
- **News & press**: GDELT, Bing News, Google News via provider.
- **Risk flags**: mugshot/arrest-record sites, complaint boards (Ripoff Report, PissedConsumer), data-broker listings (Spokeo, Whitepages, BeenVerified), breach exposure (HIBP).
- **Image search** on the name (v2).

### 4.2 Score (make it defensible)
Treat the Reputation Health Score like a credit score: **published methodology, stable, explainable, movable.**

Proposed weighting (tune later):
- **Visibility / ownership (30%)** — do you appear at all; how many of the top 10 do you control
- **Sentiment (25%)** — negative or damaging items on page 1 weighted heavily
- **Coverage & credibility (15%)** — press, authoritative mentions
- **Reviews (15%)** — rating, volume, recency, response rate (dominant weight in Business mode)
- **Social presence & consistency (10%)** — active, consistent naming across profiles
- **Privacy exposure (5%)** — data brokers, leaked PII

Non-negotiables:
- Never return a score from an unverified-everything scan the way the prototype does. Show **"Not enough data — let's find you"** instead. A confident "55" built on "I cannot confirm anything" is the single biggest credibility risk in this product.
- **Explain every sub-score with the actual evidence** (the URL that caused it).
- Score must be **re-runnable and tracked over time** — the progress chart in the repRevive mock ("↑ 18 pts") is the retention mechanic. It only works if scores are stored and comparable.

### 4.3 Improve (prototype has the skeleton; needs the back half)
The generator exists. What's missing is **everything after "Generate"**:
- Save drafts, edit, version
- **Publishing**: LinkedIn API, Google Business Profile posts/replies, X, Medium, a hosted personal page (`goodname.co/yourname` — easy win, instantly ranks, and it's yours)
- Press-release distribution (EIN Presswire, PRWeb, Accesswire) — paid, real SEO value, natural upsell
- Schema.org / Person markup on the hosted page
- Review-reply flow wired to the actual review (fetch → reply → post via GBP API)
- **Fact grounding**: generated bios must cite the user's own supplied facts. No hallucinated credentials, ever.

### 4.4 Repair (the money, absent from the prototype)
- Suppression playbook: what to publish, where, in what order, tracked against ranking movement
- **Removal requests**: Google "results about you" removal, right-to-be-forgotten (EU/UK), DMCA, site-owner outreach templates
- **Data-broker opt-outs** — semi-automatable, high perceived value, proven market (DeleteMe, Incogni)
- Escalation to a human/agency partner for defamation and legal matters — this is a referral revenue line, not something you automate

### 4.5 Protect (absent)
- Scheduled re-scans (weekly/monthly)
- **Alerts** on new mentions, rating drops, new negative results, score changes
- Dashboard with score trend + "Recent progress" feed (as in the repRevive mock)

### 4.6 Platform
Accounts & auth, billing (Stripe), scan job queue, result storage & history, entitlements/paywall, admin tooling, consent & data-deletion flows, analytics.

---

## 5. Core flow (target)

```
Land → enter name (no signup) → scan runs (~30–60s, show progress)
  → "Is this you?" disambiguation on top results
  → SCORE + evidence (free, gated: show score + 2 of 6 factors)
  → signup to unlock full report + plan
  → Improve: generate → publish → verify it ranks
  → Protect: monitoring on, re-scan monthly, score moves
  → (if negatives found) → Repair upsell / human escalation
```

The free scan is the entire acquisition engine. It must be fast, feel like real investigation (stream the sources as they're checked — the prototype's 8s spinner wastes the best moment in the product), and end on a number the user wants to improve.

---

## 6. Monetization

| Tier | Price | Contents |
|---|---|---|
| Free | $0 | One scan, score, 2 factors, top 3 plan items |
| Plus | $9–15/mo | Full report, monthly re-scan, alerts, unlimited AI content, hosted profile page |
| Pro / Business | $49–99/mo | Review integrations + replies, press distribution credits, multi-profile, competitor view |
| Repair | $500–5,000 one-off | Managed suppression + removals, human-assisted |

Ceiling note: consumer subscription churns hard once the score is "good." The durable revenue is **Business (reviews, recurring by nature)** and **Repair (high-ticket)**. Price the consumer tier as a funnel, not a business.

---

## 7. Risks — read this section twice

1. **The score is a claim about a real person.** Getting it wrong is reputationally and legally dangerous. Mandatory: evidence for every factor, "not enough data" states, and an easy dispute/correction path.
2. **FCRA.** The moment anyone uses your output to screen for employment, housing, or credit, you may be acting as a consumer reporting agency. Hard-block it in ToS, prevent third-party lookups ("search anyone" is a product you should *not* build), and get counsel before launch.
3. **Searching other people.** The prototype happily scores a name typed in by anyone. For GDPR/CCPA and for basic ethics, scope v1 to **self-lookup with verification**.
4. **Fake reviews / astroturfing.** FTC rules (2024) carry civil penalties. The "Collect authentic feedback" and "Review reply" features must never generate or solicit fabricated reviews. Guardrail the prompts and say so in the UI.
5. **Press-release spam.** Low-quality syndicated releases are the industry's dirty habit and Google devalues them. Honor the prototype's own promise — "Fresh, **truthful** content" — or the product becomes an SEO-spam machine.
6. **Data provider dependence & unit economics.** SERP API calls, enrichment, and LLM tokens per scan are real COGS. Model cost-per-scan before you open a free tier to the world; cache and rate-limit from day one.
7. **Identity collision.** Common names will break the experience unless disambiguation is a first-class step.
8. **Trademark.** "repu", "rep", "goodname" — clear them before design work hardens. Reputation.com, BrandYourself, Birdeye, Podium, NetReputation are the incumbents.

---

## 8. Competitive position

- **BrandYourself** — closest analogue, consumer DIY + managed services. Has the free score already.
- **Reputation.com / Birdeye / Podium / Broadly** — enterprise & SMB review management.
- **DeleteMe / Incogni** — data-broker removal; narrow but profitable.
- **Semrush/Brand24/Mention** — monitoring, business-facing.

**The wedge:** nobody has made this feel like Credit Karma — free, consumer, score-first, mobile, with a plan you can act on inside the same app. That's exactly what the repu board says ("Mass-market consumer appeal, like Credit Karma"). The product thesis is sound; the execution risk is all in making the score real.

---

## 9. Recommended cut

**MVP (8–12 weeks) — "Real Scan, Real Score"**
Self-lookup with verification · SERP + profile + review + news scan · classification with evidence · score with 5–6 explained factors · prioritized plan · AI content generator (bio, profile summary, review reply) · hosted public profile page · accounts + Stripe · one re-scan.
*Ship criterion: a user can point at any number in their report and see the URL that caused it.*

**V2 (next quarter) — "Improve & Protect"**
Publishing integrations (LinkedIn, Google Business Profile) · monitoring + alerts · score history chart · data-broker opt-out · Business mode with live review sync.

**V3 — "Repair"**
Suppression campaigns with rank tracking · removal-request workflows · human escalation partner · press distribution.

**Explicitly not in v1:** searching third parties, mugshot removal automation, anything that touches legal advice, enterprise multi-seat.

---

## 10. Metrics

- Scan → score completion rate (target >80%)
- Score → signup conversion (the whole funnel hinges here; target >25%)
- Signup → paid (target 4–8%)
- **Plan action completion rate** — the real engagement metric
- **Median score delta at day 90** — the only proof the product works, and your best marketing asset
- Cost per scan vs. ARPU
- Dispute/correction rate on scores (quality canary)

---

## 11. Open questions for you

1. Consumer-first or SMB-first? It changes the backend substantially.
2. Is there an appetite for the **managed repair** service (humans in the loop), or is this strictly self-serve software?
3. One brand, or are repu / repRenew / repRevive meant as separate go-to-market tests?
4. Build on the Lovable prototype or rebuild? (My read: keep it as the clickable spec, rebuild the app properly — the scan infrastructure is 90% of the work and none of it is in there.)
5. Target geography? EU/UK brings GDPR and right-to-be-forgotten into v1 rather than v2.
6. Budget tolerance for per-scan data costs on a free tier?
