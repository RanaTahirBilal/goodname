# Business Dynamics & iOS + Android Plan
Date: 2026-10-27

---

## 1. Market reality

Analyst numbers for "online reputation management" vary wildly because everyone defines it differently — **$0.5B to $8B for 2026 depending on the report**. The honest read:

| Scope | 2026 estimate | Growth |
|---|---|---|
| Broad ORM (software + services) | ~$6.9–8.1B | 12–13% CAGR |
| ORM software only | ~$5–6.5B | 9–13% CAGR |
| ORM *services* only | ~$0.5B | ~17% CAGR |

Don't put these in a deck as fact — they're directional. ([Mordor/360iResearch/Verified Market Research summary](https://www.researchandmarkets.com/reports/6243307/online-reputation-management-market-outlook))

**The number that actually matters:** roughly **70% of employers research candidates via search engines and social media**, and **54% have rejected a candidate over what they found**. Those figures are from CareerBuilder/Harris and are about a decade old — the behavior has only intensified since. ([CareerBuilder](https://www.careerbuilder.com/advice/employer-blog/employers-research-candidate-social-media-profiles)) That's your TAM statement, not an analyst's dollar figure: *every working adult is one Google search away from a decision that matters to them.*

---

## 2. Where the money actually is — four distinct businesses

The prototype blurs these. They have different buyers, margins, and churn profiles.

| Business | Price point | Churn | Margin | Verdict |
|---|---|---|---|---|
| **Consumer self-serve** | $8–15/mo | **Brutal** — churns the moment the score turns green | ~95% | Funnel, not a business |
| **Privacy / broker removal** | $96–180/yr | Low (recurring by nature — brokers re-list) | ~70% | **Best consumer annuity.** Incogni $95.88/yr, DeleteMe $129/yr |
| **SMB review management** | $300–600/mo | Low (operationally embedded) | ~85% | **The real recurring revenue.** Birdeye ~$299–449/mo, Podium $399–599/mo |
| **Repair / managed service** | $400–3,000+ | N/A, project | ~50% (labor) | **Highest ticket, lumpiest.** BrandYourself: Headstart 2×$399 then $20/mo; Concierge ~$399–599/mo; VIP $2,000+/mo |

Sources: [Incogni vs DeleteMe pricing](https://blog.incogni.com/incogni-vs-deleteme/) · [Birdeye pricing](https://www.socialpilot.co/?p=721229) · [Podium pricing](https://wisernotify.com/blog/podium-alternatives/) · [BrandYourself plans](https://us.fitgap.com/products/brandyourself)

### The structural trap
**A consumer reputation subscription has an exit ramp built into the product.** You fix their score, they cancel. Credit Karma solved this by never being the product — it was a lead-gen engine for credit cards. Your equivalents:

1. **Bundle broker removal into the subscription.** It's genuinely recurring (brokers re-list every few months), it has proven $96–180/yr willingness to pay, and it's the cheapest thing you'll ever operate.
2. **Monitoring as the steady state.** Once the score is good, the product's job becomes "tell me if anything changes." That's a $5/mo peace-of-mind subscription with near-zero COGS.
3. **Repair as the upsell, not the base.** The score *routes* people: good score → cheap monitoring; bad score → high-ticket repair.

---

## 3. Competitive map

| Player | Position | What you take from them |
|---|---|---|
| **BrandYourself** | Closest analogue. Free scan + score, DIY ~$99/yr, managed $399–2,000/mo | Their funnel works. Their mobile experience doesn't exist in any serious way — **that's your opening.** |
| **Reputation.com, Birdeye, Podium, Broadly** | Enterprise/SMB review management, quote-based, annual contracts, $300–800/mo all-in | They ignore consumers entirely. They're also expensive and sales-led — an SMB self-serve tier at $49–99/mo is an underserved slot. |
| **DeleteMe, Incogni** | Data-broker removal, $96–180/yr | Narrow, profitable, proven. Absorb this as a feature. |
| **Brand24, Mention, Semrush** | Monitoring, B2B | Not consumer, not mobile. |
| **Mugshot-removal operators** | Predatory, high-ticket, reputationally toxic | Do not become this. |

**The gap:** nobody has built a mobile-first, consumer, score-led reputation app with a real free tier. Every incumbent is a web dashboard sold to businesses or a managed service sold over the phone. The repu board's own framing — "like Credit Karma" — is the correct thesis, and nobody has executed it.

**The catch:** Credit Karma worked because credit bureau data is *structured, authoritative, and free to the user*. Reputation data is unstructured, ambiguous, and costs you money per lookup. That's why §7 of the engine spec (cost per scan) is a strategy document, not an ops detail.

---

## 4. Go-to-market

**Wedge:** free name scan, no signup, shareable result.
**Hook:** the score + the "this is what a recruiter sees" framing.
**Conversion:** blur the detail, show the plan, require email to unlock.
**Retention:** monitoring + the point-lift scoreboard.
**Expansion:** broker removal → repair → Business mode.

Channels, in order of likely efficiency:
1. **SEO on `[name] reputation` / "what shows up when you google me"** — this product ranks for its own category by nature.
2. **TikTok/Reels demo content** — "I googled myself and this is what came up" is natively viral.
3. **Job-seeker partnerships** — bootcamps, universities, career coaches, resume services.
4. **SMB vertical partnerships** (dental, legal, real estate associations) for the Business tier.
5. **Paid search on high-intent repair terms** — expensive but the LTV supports it.

**Share mechanic:** let people share their score card (score only, no detail). It's the Spotify-Wrapped move and it's free acquisition.

---

## 5. Pricing

| Tier | Price | Contents |
|---|---|---|
| **Free** | $0 | 1 lean scan, score, 2 of 6 factors, top 3 plan items |
| **Plus** | $9.99/mo or $79/yr | Full report, weekly re-scan, alerts, unlimited AI content, hosted profile page, **broker removal included** |
| **Pro** | $24.99/mo or $199/yr | Everything + press distribution credits, priority support, 2 extra profiles (family) |
| **Business** | $79/mo per location | Review sync + replies, Google Business Profile integration, competitor benchmark, team seats |
| **Repair** | $799–4,999 one-time | Managed suppression + removals, human-assisted, 90-day guarantee framing |

Annual-first pricing. Consumer monthly churn in this category is severe; annual plans are how DeleteMe and Incogni survive it.

---

## 6. Unit economics sketch

Assume 100K free scans/month, lean scan at $0.035:

```
Free scan COGS                          $3,500/mo
Scan → signup conversion      25%  →    25,000 signups
Signup → paid conversion       6%  →     1,500 new payers/mo
Blended ARPU                           ~$11/mo
New MRR added                         ~$16,500/mo
Paid COGS @ $0.35/payer                  ~$525/mo at 1,500
```

The model lives or dies on two numbers: **scan→signup conversion** and **monthly churn**. If churn exceeds ~8%/month, the consumer business never compounds and you're really running a lead-gen funnel for Repair — which is a fine business, just a different one. Instrument both from day one.

---

## 7. iOS + Android

### 7.1 Stack recommendation

**React Native (Expo) or Flutter — not two native codebases.**

This app is forms, lists, cards, charts, and push notifications. There is no performance-critical surface, no heavy device-API use, no AR/camera pipeline. Two native teams would double cost for zero user-visible benefit.

| | Recommendation |
|---|---|
| **Framework** | **React Native + Expo** — if the prototype is web/React (it is: Lovable), you reuse component logic, hiring is easier, and Expo's OTA updates let you ship copy and layout fixes without store review. Flutter is the equally defensible alternative if the team already knows Dart. |
| **Backend** | One API serving web + both apps. The heavy work (scan pipeline) is server-side regardless. |
| **Auth** | Sign in with Apple (**mandatory** if you offer any other social login on iOS), Google, email magic link |
| **Payments** | **Apple/Google IAP for in-app subscriptions — unavoidable, 15–30% cut.** Stripe on web. Push users to web checkout where permitted; know the current reader/link-out rules per store before you design the paywall. |
| **Push** | APNs + FCM, driven by the diff engine's events |
| **Analytics** | One event schema across web/iOS/Android from day one |

### 7.2 Mobile-specific design decisions

**What mobile does better than web here:**
- **"Is this you?" swipe cards** — the single best fit of this form factor to this product. Tinder-for-your-search-results is genuinely a better identity-resolution UI than a web checklist.
- **Push notifications** — "a new result about you appeared on page 1" is a perfect push. This is the retention loop web can't match.
- **Share sheet** — native score-card sharing.
- **Scan progress as a live, animated sequence** — the 8-second spinner in the prototype wastes the most dramatic moment in the product. Stream the sources as they're checked: *"Checking Google… found 14 results… checking LinkedIn… checking 47 data brokers…"* That perceived-effort moment is what makes the score feel earned, and it's what justifies the 30–60s real scan time.

**What has to change from the web prototype:**
- The two-tab structure (Score/Improve) won't carry a real app. Target 4 tabs: **Score · Improve · Protect · Me**.
- Long scrolling report → sectioned cards with drill-down.
- Content generator needs draft management, not a single textarea.

### 7.3 App Store / Play risk — plan for this now

Neither store publishes a rule specifically naming people-search apps, but both enforce broad personal-data policies and reviewers are **demonstrably hostile to anything resembling a background-check app**. Concrete mitigations:

1. **Position as a personal privacy and self-improvement tool.** Never "search anyone," "background check," "look up a person," or "find out about someone" — in the listing, the screenshots, the keywords, or the app itself.
2. **Enforce self-lookup in the product**, not just the copy. A reviewer who types in a celebrity's name and gets a dossier is a rejection.
3. **Full data-safety / privacy nutrition labels**, accurate on first submission. Declare the data you collect and why.
4. **In-app account deletion** — required by both stores.
5. **Submit the privacy policy and ToS with the first build**, and make the FCRA/no-screening prohibition prominent in both.
6. Budget **2–3 review cycles** for the first submission. Plan the launch date accordingly.

([Play policy overview](https://support.google.com/googleplay/android-developer/answer/9842754) · [rejection mechanics](https://qawerk.com/blog/google-play-rejection-reasons/) — neither store's people-search stance is documented publicly, so treat the above as risk management rather than compliance with a known rule.)

### 7.4 Platform sequencing

| | Plan |
|---|---|
| **Web first** | Yes. The free scan is an SEO and share-link product; it must live on the open web. Ship web, prove scan→signup conversion, then wrap. |
| **iOS second** | Higher ARPU, better subscription conversion, the audience that pays for this. |
| **Android third** | 2–4 weeks behind iOS with React Native/Flutter. Larger international audience, lower ARPU. |

Realistic timeline with the engine from the other doc: **web MVP at ~12 weeks, iOS at ~16–18, Android at ~18–20.**

---

## 8. The three decisions that set everything else

1. **Consumer-first or SMB-first.** Consumer = SERP infrastructure, viral free scan, churn problem. SMB = Google Business Profile approval (start the application this week — it's manually reviewed and slow), review integrations, higher ACV, sales motion. **My recommendation: consumer-first for the funnel, but build the data model so Business mode is a weight change and two integrations, not a rewrite.** The engine spec already does this.
2. **Is Repair in scope?** If yes, you need humans and a different company shape. If no, you cap revenue at consumer subscription levels and should lean much harder into bundled privacy removal.
3. **One brand or three.** Ship one. Use the score to route between hopeful and remedial messaging inside the same app.

---

## 9. Open questions

- Target geography at launch? (EU/UK pulls GDPR and right-to-erasure into v1.)
- Do you have access to a human ops partner for Repair, or would that be built?
- Budget ceiling for free-tier scan COGS per month — this sets the free scan's depth.
- Is there an existing brand/domain commitment among repu / goodname / rep, or is that still open?
- Team composition — does anyone know React Native/Flutter already? That should decide the framework more than any technical argument.

---

Sources: [ORM market outlook](https://www.researchandmarkets.com/reports/6243307/online-reputation-management-market-outlook) · [CareerBuilder employer screening study](https://www.careerbuilder.com/advice/employer-blog/employers-research-candidate-social-media-profiles) · [Incogni vs DeleteMe pricing](https://blog.incogni.com/incogni-vs-deleteme/) · [Birdeye pricing breakdown](https://www.socialpilot.co/?p=721229) · [Podium pricing](https://wisernotify.com/blog/podium-alternatives/) · [BrandYourself plans](https://us.fitgap.com/products/brandyourself) · [Google Play developer policy](https://support.google.com/googleplay/android-developer/answer/9842754) · [Google Play rejection reasons](https://qawerk.com/blog/google-play-rejection-reasons/)
