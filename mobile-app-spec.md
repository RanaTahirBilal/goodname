# Mobile App Spec — iOS + Android
*Screens, flows, navigation, components. API contract lives in `api-contract.md`.*
Date: 2026-10-27 · Target: React Native + Expo, single codebase

---

## 0. Ground rules

1. **The free scan runs before any account exists.** Name → score with zero friction. Auth is a gate on *detail*, never on the scan itself.
2. **No number without evidence.** Every score, factor, and alert drills down to the URL that caused it.
3. **Offline is read-only.** The last scan snapshot is cached and fully browsable with no network. Scans, generation, and publishing require connectivity and say so.
4. **Platform-native where it counts.** iOS uses SF Symbols, native share sheet, Sign in with Apple, haptics on score reveal. Android uses Material ripples, system back, FCM channels. Everything else is shared.
5. **Self-lookup only.** There is no UI anywhere that lets a user scan another person. This is a legal requirement, not a product choice (see the engine spec, §8).

---

## 1. Navigation model

```
RootNavigator (switch on auth + scan state)
│
├── OnboardingStack            [no account, no scan]
│   ├── Welcome
│   ├── ValueCarousel          (skippable, 3 cards)
│   └── ScanStart              ← entry point, deep-link target
│
├── ScanStack                  [modal, full-screen, non-dismissible mid-run]
│   ├── ScanProgress
│   ├── IsThisYou              (conditional: only if ambiguous results exist)
│   ├── ScoreReveal            (animated, one-time per scan)
│   └── SignupGate             (conditional: free user hitting detail)
│
└── MainTabs                   [post-scan; works signed-out with limited detail]
    ├── Score      ── ScoreHome → FactorDetail → EvidenceDetail → DisputeFlow
    │                          → ScoreHistory
    ├── Improve    ── PlanHome → ActionDetail → ContentStudio → DraftEditor
    │                          → PublishSheet → DraftsLibrary → ProfilePageEditor
    ├── Protect    ── ProtectHome → AlertDetail
    │                            → BrokerRemoval → BrokerDetail
    │                            → RemovalRequests → RemovalWizard
    │                            → ScanSchedule
    └── Me         ── MeHome → IdentityProfile → ConnectedAccounts
                            → Subscription → Notifications
                            → PrivacyData → Legal → BusinessSwitcher
```

**Tab bar:** 4 items. Labels `Score · Improve · Protect · Me`. Badge count on **Protect** for unread alerts.

**Business mode** is a context switch in `Me → BusinessSwitcher`, not a fifth tab. Switching swaps the tab contents: `Score · Reviews · Protect · Me`. Personal and business profiles never render at the same time.

**Deep links**
| URL | Destination |
|---|---|
| `goodname://scan?name=…` | ScanStart prefilled |
| `goodname://score` | ScoreHome |
| `goodname://alert/{id}` | AlertDetail |
| `goodname://plan/{actionId}` | ActionDetail |
| `goodname://draft/{id}` | DraftEditor |
| Universal links | `https://goodname.co/s/{shareToken}` → public score card |

---

## 2. Screen-by-screen

### 2.1 Welcome
**Purpose:** one screen, one job — get to the scan.

| | |
|---|---|
| Content | Wordmark, `Your reputation. Your future.`, sub: `Build it. Improve it. Protect it.` |
| Primary | `Check my score` → ScanStart |
| Secondary | `I already have an account` → sign-in sheet |
| Notes | No signup wall. No permissions requested yet. Notification permission is asked **after** the first score, never here. |

### 2.2 ValueCarousel *(skippable)*
Three cards, swipeable, dot indicator, `Skip` top-right.
1. *See what shows up* — mock SERP illustration
2. *Get a clear plan* — mock plan rows with lift badges
3. *Stay protected* — mock alert push

Show once. Persist `hasSeenOnboarding`. **A/B this against skipping it entirely — my prior is that it costs conversion.**

### 2.3 ScanStart — *the most important screen in the app*

| Element | Spec |
|---|---|
| Segmented control | `Individual` / `Business` — defaults to Individual |
| Field 1 | Full name. Required. Autocapitalize words, autocorrect off, `textContentType="name"` |
| Field 2 | Optional context: city, industry, job title, employer. **Rendered as 4 separate optional chips-with-fields, not one blob** — the prototype's single "Optional: city, industry, job title, website" field produces unusable input for query expansion |
| Field 3 | Website / personal domain (optional, keyboard `url`) |
| Primary CTA | `Check my score` — disabled until name has ≥2 tokens |
| Microcopy | `We scan public search results, profiles, news and data brokers. This takes about a minute.` |
| Legal line | `This is a scan of your own name. Not for screening other people.` — small, always visible, links to ToS |

**Self-lookup enforcement.** On the second and subsequent scans, the name must match the verified identity on file, or the user must re-verify. Free first scan is open; everything after is bound to an account.

**States:** `idle` · `validating` · `submitting` · `error` (network, rate-limited, blocked name)
**Rate limit copy:** `You've used your free scan. Create a free account to keep going.` → SignupGate

### 2.4 ScanProgress — *where the product earns the score*

Full-screen, non-dismissible. Backed by SSE (`GET /v1/scans/{id}/events`). This replaces the prototype's 8-second spinner.

**Layout**
```
┌─────────────────────────────┐
│   [animated radial pulse]   │
│                             │
│   Checking your reputation  │
│                             │
│  ✓ Searched Google          │  ← completed rows, checkmark, fade in
│  ✓ Found 14 results         │
│  ✓ Checked LinkedIn, X, IG  │
│  ⟳ Scanning 47 data brokers │  ← active row, spinner
│    Checking news & press    │  ← pending, dimmed
│    Building your score      │
│                             │
│  ▓▓▓▓▓▓▓▓▓░░░░░  68%        │
└─────────────────────────────┘
```

| | |
|---|---|
| Event source | `scan.stage` events from the API, each with `label`, `status`, `detail` |
| Min duration | **12s floor** even if the backend finishes sooner. Perceived effort is load-bearing here; an instant score feels fake. |
| Max duration | 90s. Past that → `ScanTimeout` state with `Notify me when it's ready` (push) and background completion |
| Backgrounding | Scan continues server-side. Push on completion. Re-entering the app resumes the stream or jumps to the result. |
| Cancel | Small `Cancel` after 20s only |
| Haptic | Light tick per completed stage (iOS), subtle vibration disabled by default on Android |

### 2.5 IsThisYou — *swipe deck*

**Shown only when the resolver returns `NEEDS_REVIEW` items.** Max 10 cards. Never blocks the score.

```
┌─────────────────────────────┐
│  Help us find the right you │
│  3 of 7                     │
│ ┌─────────────────────────┐ │
│ │ [favicon] example.com   │ │
│ │ Jensen Adoni named VP   │ │
│ │ of Engineering at Acme  │ │
│ │                         │ │
│ │ "…Chicago-based Jensen  │ │
│ │  Adoni joins Acme…"     │ │
│ │                         │ │
│ │ Google result #6        │ │
│ └─────────────────────────┘ │
│   ✕ Not me   ? Not sure  ✓ Me │
└─────────────────────────────┘
```

| | |
|---|---|
| Gestures | Swipe left = Not me, right = Me, up = Not sure. Buttons mirror all three. |
| Undo | Tap-to-undo the last card, 5s window |
| Skip | `Skip for now` — proceeds to score with reduced confidence, and the ConfidenceBanner says so |
| Effect | Each answer POSTs immediately and updates the score live behind the deck |
| Empty | If no ambiguous items, this screen never mounts |

This screen is the highest-value interaction in the app. It improves the score's accuracy, trains the resolver, and makes the user feel like a participant rather than a subject.

### 2.6 ScoreReveal

One-time animated reveal per scan. Gauge counts up from 0 over ~1.2s with easing, band color resolves at the end, success haptic on settle.

**Three variants, driven by `confidence`:**

| Confidence | Render |
|---|---|
| `≥ 0.7` | Gauge with number + band label. Normal path. |
| `0.4 – 0.7` | Gauge + amber ConfidenceBanner: `Low confidence — confirm a few results to sharpen this` → returns to IsThisYou |
| `< 0.4` | **No number.** Large illustration + `We couldn't find much about you yet.` + `That's not bad news — it means the page is yours to write.` → CTA `See my plan` |

That third variant is the fix for the prototype's credibility hole. It converts *better* for job seekers than a fabricated 55.

Below the gauge: `Share my score` (score + band only, never detail), `See what we found`.

### 2.7 SignupGate
Triggered when a signed-out user taps any gated surface (factor detail, full plan, re-scan, content studio).

| | |
|---|---|
| Framing | `Your full report is ready.` + blurred preview of the real report behind the sheet |
| Methods | Sign in with Apple (iOS, listed first), Google, Email magic link |
| Legal | ToS + Privacy checkboxes, unticked, required |
| Dismissal | Dismissible — returns to the free view. Never trap the user. |

### 2.8 ScoreHome *(tab 1)*

Scroll container, sections in order:

1. **ScoreGauge card** — number, band, `Updated {date}`, tap → ScoreHistory
2. **ConfidenceBanner** — only when confidence < 0.7
3. **TrendSparkline** — last 6 scans, `↑18 pts since August`. Hidden for first-time users.
4. **Factor list** — 6 `FactorRow`s: name, sub-score, band color, one-line reason, chevron
   - Free users: 2 unlocked, 4 blurred with a lock chip → SignupGate
5. **"Your online presence" narrative** — 3–4 sentences, collapsible
6. **Footer** — `Re-scan` (with cooldown state), `How scoring works` → methodology sheet

**States:** `loading` (skeleton) · `loaded` · `stale` (cached, offline banner) · `scanning` (inline progress) · `error`

**Pull-to-refresh** triggers a re-scan if cooldown allows; otherwise it just refetches the snapshot and shows a toast with the next eligible time.

### 2.9 FactorDetail
Header: factor name, sub-score gauge, plain-language definition of what it measures and how it's weighted.
Body: **evidence list** — every artifact contributing to this factor, as `EvidenceCard`s, sorted by impact.
Footer: `What would improve this?` → filtered PlanHome.

### 2.10 EvidenceDetail
One artifact. Favicon, domain, title, snippet, SERP position, date, labels (ownership / sentiment / severity), and **"Why this affects your score"** in one sentence.

Actions:
- `This isn't me` → removes from identity graph, recomputes score, confirmation toast with undo
- `This is wrong` → DisputeFlow
- `Open page` → in-app browser (**never** a raw WebView without a URL bar; show the full domain)
- `Help me fix this` → ActionDetail or Repair upsell if severity ≥ 3

### 2.11 DisputeFlow
3 steps: *what's wrong* (picker: not me / inaccurate / outdated / miscategorized / other) → *details* (free text, optional) → *submit*. Routes to the human review queue. Status visible in `Me → Disputes`. SLA copy: `We review disputes within 3 business days.`

### 2.12 ScoreHistory
Line chart of score over time, annotated with events (`Published bio`, `Removed 2 broker listings`). Below: reverse-chronological snapshot list with per-scan deltas. This is the proof-of-value screen — **it's also your best retention asset and your best marketing asset.**

### 2.13 PlanHome *(tab 2)*

```
Your improvement plan
Potential: +25 points

┌───────────────────────────────────┐
│ ① Create an authoritative bio     │
│   Publish a factual biography…    │
│   [+7 pts]  [Low effort]  [High]  │
│                          ✓ Done → │
└───────────────────────────────────┘
```

| | |
|---|---|
| Sort | `lift ÷ effort`, descending. User can re-sort by priority or effort. |
| Each row | Title, one-line description, **LiftBadge (+N pts)**, EffortChip, PriorityChip, completion state |
| Progress | Header shows `3 of 8 done` + total points realized |
| States | `not_started` · `in_progress` · `done` · `dismissed` |
| Completion | Manual check-off **and** automatic — when a re-scan detects the artifact that the action called for, mark it done and celebrate it with a toast + the point delta |

Automatic completion detection is what separates this from a to-do list.

### 2.14 ActionDetail
Why it matters, expected lift, step-by-step instructions, and a **direct CTA into the tool that does it**:

| Action type | CTA destination |
|---|---|
| Create bio / profile summary | ContentStudio, pre-selected type |
| Connect verified profiles | ConnectedAccounts |
| Seek coverage | ContentStudio → press release + distribution upsell |
| Collect feedback | Review-request flow (Business) |
| Monitor mentions | ScanSchedule + notification opt-in |
| Remove broker listing | BrokerDetail |

### 2.15 ContentStudio
Rebuilt from the prototype's single-form generator.

**Step 1 — Type:** 2×2 grid — `Online bio` · `Press release` · `Profile summary` · `Review reply`
**Step 2 — Subject:** Individual / Business (inherits the profile, editable)
**Step 3 — Inputs:** dynamic per type
- Bio / profile summary: name (prefilled), role, achievements (multi-line), credentials, location, links
- Press release: headline hook, what happened, date, quote, boilerplate
- Review reply: paste the review (or **pick from synced reviews** in Business mode), rating, resolution offered
**Step 4 — Tone:** `Professional` · `Warm` · `Bold` segmented control, with a one-line sample of each
**Step 5 — Generate:** streams the draft token-by-token into the editor

| | |
|---|---|
| Grounding | Generation uses **only** user-supplied facts. A visible note: `We only write what you tell us. Nothing invented.` |
| Guardrail | Review-reply generation never fabricates experiences; press-release generation requires a real, dated event. Blocked attempts show a short explanation, not a generic error. |
| Length | Per-type target with a live character/word count |

### 2.16 DraftEditor
Rich-text-lite (bold, italic, lists, links). Autosave every 2s with a `Saved` indicator. Version history (last 10). Actions: `Regenerate` (keeps inputs, new output), `Adjust tone`, `Shorten` / `Lengthen`, `Copy`, `Publish`.

### 2.17 PublishSheet
Bottom sheet listing destinations with connection state:

| Destination | Behavior |
|---|---|
| **Your goodname page** (`goodname.co/{slug}`) | One tap. Always available. Ships with Person schema.org markup. **This is the easiest ranking win in the product** — make it the default. |
| LinkedIn | OAuth-connected, posts or updates About |
| Google Business Profile | Business mode; posts or review replies |
| X | OAuth |
| Copy to clipboard | Always |
| Press distribution | Paid credits, shows price before confirm |

Every publish is confirmed in a review step showing exactly what will be posted and where. **Never auto-publish.**

### 2.18 ProfilePageEditor
The hosted page: headline, bio, photo, links, credentials, slug, visibility toggle, custom-domain field (paid). Live preview. `Open live page` button.

### 2.19 ProtectHome *(tab 3)*

1. **Monitoring status card** — `Active · next scan Tuesday`, or `Off` with an enable CTA
2. **Alerts feed** — reverse-chronological `AlertRow`s, unread dot, grouped by day
3. **Quick tiles** — `Data brokers (3 active)` · `Removal requests (1 pending)` · `Scan schedule`

**Alert types:** `new_negative` · `new_result` · `position_change` · `score_change` · `new_review` · `rating_drop` · `broker_relisted` · `profile_change`

### 2.20 AlertDetail
What changed, when, the artifact, score impact (`−4 pts`), and `What to do` → ActionDetail. Dismiss / mute this source.

### 2.21 BrokerRemoval
List of broker sites with the user's listing status:

| StatusPill | Meaning |
|---|---|
| `Listed` | Found, not yet requested |
| `Requested` | Opt-out submitted, awaiting |
| `Removed` | Confirmed gone |
| `Re-listed` | Came back — auto re-request |

Header: `12 of 47 sites have your data`. CTA `Remove all` (paid). Free users see the list and can do it manually with per-site instructions — **this is a good free feature that demonstrates value honestly**.

### 2.22 RemovalWizard
Guided flow for Google "Results about you" requests and site-owner outreach. Picks the right path per artifact type, pre-fills the request, and tracks status. Google's own tool is free — the product's value is knowing *which* requests to file and tracking them, not gatekeeping access.

### 2.23 ScanSchedule
Frequency picker (Monthly / Weekly / Daily-Business), per-type notification toggles, quiet hours, `Scan now`.

### 2.24 MeHome *(tab 4)*
Rows: Identity & profile · Connected accounts · Subscription · Notifications · Disputes · Privacy & data · Switch to Business · Help · Legal · Sign out.
Header: avatar, name, current score chip, plan badge.

### 2.25 IdentityProfile
The facts the scan uses: name, known aliases/maiden names, city, employer, job title, industry, websites, email(s). Editing any of these invalidates the current scan and prompts a re-scan.

### 2.26 ConnectedAccounts
LinkedIn, Google, X, Instagram, Facebook, GitHub, personal domain (DNS TXT verification). Each shows connection state and what it unlocks. Connecting raises identity confidence — **say so on the row**: `Connecting raises your scan accuracy`.

### 2.27 Subscription
Current plan, renewal date, usage (scans used, content generated), upgrade/downgrade, restore purchases (required by both stores), manage via native subscription settings.

### 2.28 PrivacyData
Export my data (JSON + PDF report), delete my account (**in-app, required by both stores**, with a clear two-step confirm and a 30-day grace note), data retention explainer, consent toggles.

### 2.29 Business mode screens
- **LocationsList** → per-location score
- **ReviewsInbox** — synced reviews, filter by rating/responded, swipe to reply
- **ReplyComposer** — AI-drafted reply, edit, post via GBP API
- **CompetitorBenchmark** — your rating/volume vs 3 local competitors
- **ReviewRequest** — send a request link by SMS/email (**never generate or solicit fake reviews — FTC rules carry civil penalties**)

---

## 3. Component inventory

### 3.1 Core
| Component | Props (abbreviated) | Notes |
|---|---|---|
| `ScoreGauge` | `value \| null`, `band`, `size`, `animate`, `confidence` | SVG arc. Handles the null/low-confidence case natively — **do not render 0 for unknown**. |
| `ConfidenceBanner` | `confidence`, `onImprove` | Amber. Only renders below 0.7. |
| `FactorRow` | `name`, `score`, `band`, `reason`, `locked`, `onPress` | Locked variant blurs the value and shows a lock chip. |
| `EvidenceCard` | `favicon`, `domain`, `title`, `snippet`, `position`, `labels[]`, `impact` | Severity tints the left border. |
| `LiftBadge` | `points` | `+7 pts`. Green. |
| `EffortChip` / `PriorityChip` | `level` | Low/Med/High. |
| `ActionCard` | `action`, `status`, `onPress`, `onToggleDone` | |
| `AlertRow` | `type`, `title`, `timestamp`, `unread`, `impact` | Icon per type. |
| `StatusPill` | `status`, `label` | Broker + removal states. |
| `SwipeCardDeck` | `cards[]`, `onDecide`, `onUndo` | Reanimated gesture handler. |
| `ScanProgressStream` | `stages[]`, `progress` | Consumes SSE events. |
| `TrendChart` | `points[]`, `annotations[]` | Victory Native or Skia. |
| `ToneSelector` | `value`, `options`, `samples` | |
| `DraftEditor` | `value`, `onChange`, `streaming` | Supports token streaming. |
| `PublishSheet` | `destinations[]`, `draft`, `onPublish` | |
| `Paywall` | `trigger`, `plans[]`, `onPurchase`, `onRestore` | IAP-aware. |

### 3.2 Primitives
`Button` (primary/secondary/ghost/destructive) · `SegmentedControl` · `TextField` · `TextArea` · `Chip` · `Card` · `BottomSheet` · `Toast` · `Skeleton` · `EmptyState` · `ErrorState` · `OfflineBanner` · `ProgressBar` · `Avatar` · `Icon`

### 3.3 Required states for every data-bearing screen
`loading` (skeleton, never a bare spinner) · `empty` (illustration + one action) · `error` (cause + retry) · `offline` (cached content + banner) · `locked` (blurred + upgrade CTA)

**No screen ships without all five.** This is the most common source of "the app feels unfinished."

### 3.4 Design tokens
```
color.brand.900   #0F3D2E   (wordmark, primary text)
color.brand.600   #1F6B4F   (primary button)
color.brand.100   #E8F2EC   (surface tint)
color.band.excellent #16A34A
color.band.good      #4ADE80
color.band.fair      #F59E0B
color.band.attention #FB923C
color.band.risk      #DC2626
radius.card 16 · radius.pill 999
space 4/8/12/16/24/32
type.display 32/700 · title 22/600 · body 16/400 · caption 13/400
```
Dark mode is required on both platforms — define every token in both themes from day one rather than retrofitting.

### 3.5 Accessibility
Minimum 44×44pt touch targets. Dynamic Type / font scaling supported to 200%. **The gauge must announce its value as text** (`"Your score is 68 out of 100, Fair"`) — a VoiceOver user cannot read an arc. Color is never the only signal for band or severity; pair it with a label. Swipe cards have full button equivalents.

---

## 4. Push notifications

| Trigger | Copy | Deep link |
|---|---|---|
| Scan complete (backgrounded) | `Your reputation score is ready` | `//score` |
| New negative result | `A new result about you appeared on page 1` | `//alert/{id}` |
| Score change ≥ 3 pts | `Your score went up 6 points` | `//score` |
| Broker re-listed | `{Site} re-listed your data. We're on it.` | `//protect/brokers` |
| New review (Business) | `New 2-star review on Google` | `//reviews/{id}` |
| Plan nudge (weekly, opt-in) | `One step could add +7 points` | `//plan/{actionId}` |

**Permission is requested after the first score reveal, framed in context:** `Want us to tell you if something new shows up about you?` — not on launch. Android 13+ requires the runtime permission anyway; use channels (`alerts`, `score`, `marketing`) so users can mute marketing without losing security alerts.

---

## 5. Analytics events

One schema across web, iOS, Android. Minimum set:

```
scan_started            {source, has_optional_fields, mode}
scan_stage_viewed       {stage, elapsed_ms}
scan_completed          {duration_ms, artifacts_found, confidence, score|null}
scan_abandoned          {stage, elapsed_ms}
isthisyou_shown         {card_count}
isthisyou_decided       {decision, card_index}
score_revealed          {score|null, band, confidence_bucket}
score_shared            {channel}
signup_gate_shown       {trigger}
signup_completed        {method}
factor_opened           {factor}
evidence_opened         {factor, severity}
dispute_submitted       {reason}
plan_action_opened      {action_type, predicted_lift}
plan_action_completed   {action_type, auto_detected}
content_generated       {type, tone}
content_published       {destination}
paywall_shown           {trigger, plan_set}
purchase_completed      {plan, price, store}
rescan_triggered        {source}
alert_opened            {type}
```

**The two north-star funnels:** `scan_started → score_revealed → signup_completed` and `plan_action_opened → plan_action_completed → score_change`. Everything else is secondary.

---

## 6. Offline & caching

| Data | Policy |
|---|---|
| Latest scan snapshot | Cached in full (MMKV/SQLite), browsable offline, `stale` banner after 24h |
| Score history | Cached, last 20 snapshots |
| Drafts | Local-first, synced on reconnect, conflict = keep both |
| Alerts | Last 50 cached |
| Scan / generate / publish | Online only — disabled with explanatory copy, not a silent failure |

Queue publish and dispute actions when offline; flush on reconnect with a toast.

---

## 7. Store submission requirements

| Requirement | Both stores |
|---|---|
| In-app account deletion | **Mandatory.** `Me → Privacy & data → Delete account` |
| Restore purchases | **Mandatory** on iOS, expected on Android |
| Sign in with Apple | **Mandatory** on iOS if Google sign-in is offered |
| Privacy nutrition label / Data safety form | Complete and accurate on first submission |
| Subscription terms before purchase | Price, period, renewal, and a link to terms on the paywall itself |
| Account-free core function | The free scan works without an account — helps with both stores |

**Positioning discipline (rejection risk):** nowhere in the listing, screenshots, keywords, or app copy should the words *background check*, *search anyone*, *look up a person*, or *people search* appear. Describe the app as a **personal privacy and online-presence tool**. Enforce self-lookup in the product itself, because a reviewer will type in a celebrity's name — and if they get a dossier, you're rejected.

Budget **2–3 review cycles** for the first submission on each store.

---

## 8. Build sequence

| Sprint | Scope |
|---|---|
| 1 | Navigation shell, design tokens, primitives, auth, API client |
| 2 | ScanStart → ScanProgress (SSE) → ScoreReveal, offline cache |
| 3 | IsThisYou deck, ScoreHome, FactorDetail, EvidenceDetail |
| 4 | PlanHome, ActionDetail, auto-completion detection |
| 5 | ContentStudio, DraftEditor, PublishSheet, goodname page |
| 6 | ProtectHome, alerts, push, ScanSchedule |
| 7 | Paywall + IAP, Subscription, PrivacyData, account deletion |
| 8 | Broker removal, RemovalWizard, disputes |
| 9 | Business mode (reviews inbox, reply composer) |
| 10 | Polish, a11y pass, dark mode audit, store assets, submission |

iOS and Android ship from the same sprints; **budget one extra week for Android-specific QA** (back behavior, notification channels, fragmentation, Play data-safety form).
