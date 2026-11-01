# Search Providers

Research for `OPEN_QUESTIONS.md` OQ-3. Prices checked **30 October 2026** from
the providers' own pricing pages, not from comparison blogs — the blogs
disagreed with each other and with the source on several figures.

**Nothing here is contracted.** No credentials exist and no provider has been
chosen.

---

## What an audit actually costs

`buildQueries()` produces one term for the name, one for name + employer, one
for name + city, plus one per alias. So a typical audit is **3 search calls**
at a window of 10 results, 4–5 if the customer has published under other
names.

| Provider | Mode | Per search | **Per audit (3 calls)** | Turnaround |
|---|---|---:|---:|---|
| DataForSEO | Standard queue | $0.0006 | **$0.0018** | ~5 min avg, 45 min target |
| DataForSEO | Priority queue | $0.0012 | **$0.0036** | faster queue |
| DataForSEO | Live | $0.002 | **$0.006** | up to ~6 s |
| SerpApi | Production ($150 / 15k) | $0.010 | **$0.030** | synchronous |
| SerpApi | Starter ($25 / 1k) | $0.025 | **$0.075** | synchronous |

A 17× spread between the cheapest and the dearest realistic option.

### The number that settles the business question

Search cost is **rounding error against the subscription price**.

Professional Authority is $750/month with monthly monitoring; Executive is
$2,000/month with weekly. Weekly monitoring is roughly 4 scans a month, so
12 search calls:

| Plan | Monthly search cost at SerpApi | As a share of price |
|---|---:|---:|
| Professional Authority ($750) | ~$0.03 | 0.004% |
| Executive Authority ($2,000) | ~$0.12 | 0.006% |

**Provider choice is not a margin decision for paying customers.** The cost
that matters on those plans is human QA and content production, not search.

### Where cost does matter: the free audit

The free tier is unbounded demand, so it is the only place the per-search
price is material.

| Free audits / month | DataForSEO Standard | DataForSEO Live | SerpApi Production |
|---:|---:|---:|---:|
| 1,000 | $1.80 | $6 | $30 |
| 10,000 | $18 | $60 | $300 |
| 100,000 | $180 | $600 | $3,000 |

Even the expensive option is survivable at realistic volume. At 100,000 free
audits a month the difference becomes real, but a product seeing that volume
has a conversion problem worth more attention than its search bill.

---

## The finding that drives the architecture

**The cheapest option cannot be used synchronously.**

DataForSEO Standard averages ~5 minutes with a 45-minute target. That cannot
sit inside an HTTP request under any circumstances. Even Live mode at ~6
seconds, multiplied by 3 calls plus classification, is past the point where
holding a connection open is reasonable.

So background jobs are not a nice-to-have for later. **They are what makes
the 17× cheaper option available at all**, and they are the difference
between a free tier that costs $1.80 per thousand and one that costs $30.

That is OQ-11, and it is the next thing to build.

---

## Assessment

### DataForSEO — recommended to trial first

**For:** Cheapest by a wide margin. Pay-as-you-go with a $50 minimum top-up
and no subscription, so there is no commitment while volume is unknown.
Three speed tiers let the same provider serve a slow free audit and a fast
paid rescan.

**Against:** The queue model is more moving parts. Search operators such as
`site:` multiply task cost by 5 — relevant, because an obvious optimisation
for this product is exactly that kind of query. Rate limits and commercial
terms were not on the pricing page and need to be confirmed in writing.

### SerpApi — the safer, dearer option

**For:** Simplest integration, synchronous, and the only one advertising
legal cover: a "U.S. Legal Shield" up to $2M on Production and above,
covering scraping and parsing of search engine data. For a product whose
whole premise is handling other people's reputational data carefully, an
explicit legal position has value beyond the line item.

**Against:** 5–17× the cost. Throughput is capped per hour by plan (3,000/hr
on Production), which is a ceiling worth modelling before a launch spike.

### Serper — not assessed

Advertises 2,500 free queries and "1–2 seconds", but its public page carried
no pricing table, rate limits or terms. Cannot be compared on the available
evidence.

---

## Recommendation

1. **Build background jobs first** (OQ-11). Until that exists, the cheap tier
   is unreachable and the provider decision is being made with one hand tied.
2. **Trial DataForSEO** on the $50 minimum. No subscription, so the downside
   is capped at $50 and a few days.
3. **Get commercial terms in writing from both** before committing. Neither
   published terms covering our use — redistributing derived analysis of
   search results to a paying third party — and that question matters more
   than the price difference.
4. **Keep the provider interface as it is.** `SearchProvider` already
   normalises results and reports failure explicitly, so trialling one is an
   adapter, not a migration. Nothing above requires an engine change.

---

## Still unanswered

- Written commercial terms for our specific use, from any provider.
- Whether results may be **stored** and for how long. We retain evidence
  records; a provider forbidding retention would change the data model, not
  just the adapter.
- Geographic coverage for non-US customers.
- What happens at a launch spike against a per-hour throughput cap.

## Sources

- [SerpApi pricing](https://serpapi.com/pricing)
- [DataForSEO pricing](https://dataforseo.com/pricing)
- [DataForSEO Google Organic SERP API](https://dataforseo.com/pricing/serp/google-organic-serp-api)
- [Serper](https://serper.dev/)
