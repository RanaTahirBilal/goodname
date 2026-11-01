# API Contract — Mobile & Web Clients
*Companion to `mobile-app-spec.md`. One API serves web, iOS, and Android.*
Date: 2026-10-27 · Base: `https://api.goodname.co/v1`

---

## 0. Conventions

| | |
|---|---|
| Format | JSON, `application/json`, UTF-8 |
| Dates | ISO-8601 UTC (`2026-10-27T14:03:00Z`) |
| IDs | Prefixed ULIDs — `scan_01JB…`, `art_…`, `act_…`, `drf_…`, `alr_…`, `usr_…` |
| Auth | `Authorization: Bearer <jwt>`; anonymous scans use `X-Device-Id` |
| Versioning | URL path (`/v1`). Breaking changes bump the path; additive fields never do. |
| Client header | `X-Client: ios/1.4.0` — required, used for forced-upgrade gating |
| Idempotency | `Idempotency-Key` required on all POSTs that cost money or create jobs |
| Pagination | Cursor: `?limit=25&cursor=…` → `{ data: [], next_cursor: "…"\|null }` |
| Rate limits | `X-RateLimit-Limit` / `-Remaining` / `-Reset` on every response |

### Error envelope
```json
{
  "error": {
    "code": "scan_rate_limited",
    "message": "You've used your free scan.",
    "user_message": "Create a free account to keep scanning.",
    "retry_after": 86400,
    "details": {}
  }
}
```
`message` is for logs; **`user_message` is the only string the client renders.** Clients never compose error copy from codes.

| HTTP | Codes |
|---|---|
| 400 | `invalid_request`, `invalid_name`, `unsupported_region` |
| 401 | `unauthenticated`, `token_expired` |
| 403 | `forbidden`, `self_lookup_required`, `plan_required` |
| 404 | `not_found` |
| 409 | `scan_in_progress`, `conflict` |
| 422 | `generation_refused` (guardrail hit) |
| 429 | `scan_rate_limited`, `rate_limited` |
| 503 | `provider_degraded` (SERP provider down — returns partial scan) |

---

## 1. Auth

### `POST /auth/anonymous`
Issues a device-scoped token so the free scan works before signup.
```json
→ { "device_id": "dev_01JB…", "platform": "ios" }
← { "access_token": "…", "expires_in": 3600, "anonymous": true }
```

### `POST /auth/apple` · `POST /auth/google`
```json
→ { "identity_token": "…", "nonce": "…", "link_device_id": "dev_01JB…" }
← { "access_token": "…", "refresh_token": "…", "expires_in": 3600,
    "user": { "id": "usr_…", "email": "…", "verification_tier": "email_verified" } }
```
`link_device_id` **migrates the anonymous scan onto the new account** — without it the user loses their first scan at signup, which is the single most damaging thing this API could do to conversion.

### `POST /auth/magic-link` → `POST /auth/magic-link/verify`
### `POST /auth/refresh` · `POST /auth/logout`

---

## 2. Identity

### `GET /me`
```json
{
  "id": "usr_…",
  "email": "j@example.com",
  "verification_tier": "email_verified",
  "mode": "individual",
  "plan": { "tier": "free", "renews_at": null, "scans_remaining": 0 },
  "profile": {
    "full_name": "Jensen Adoni",
    "aliases": [],
    "city": "Chicago, IL",
    "employer": "Acme Health",
    "job_title": "VP Engineering",
    "industry": "Healthcare",
    "websites": ["https://jensenadoni.com"]
  },
  "connected_accounts": [
    { "provider": "linkedin", "status": "connected", "handle": "jensenadoni",
      "confidence_boost": 0.15 }
  ],
  "latest_scan_id": "scan_01JB…"
}
```

### `PATCH /me/profile`
Changing any identity field returns `"scan_invalidated": true` so the client can prompt a re-scan.

### `POST /me/accounts/{provider}/connect` · `DELETE /me/accounts/{provider}`
### `POST /me/domains/verify` — DNS TXT challenge
```json
→ { "domain": "jensenadoni.com" }
← { "record": "goodname-verify=abc123", "status": "pending" }
```

---

## 3. Scans

### `POST /scans`
```json
→ {
  "mode": "individual",
  "full_name": "Jensen Adoni",
  "city": "Chicago, IL",
  "employer": "Acme Health",
  "job_title": "VP Engineering",
  "industry": "Healthcare",
  "website": "https://jensenadoni.com",
  "depth": "lean"
}
← 202 {
  "id": "scan_01JB…",
  "status": "queued",
  "depth": "lean",
  "estimated_seconds": 45,
  "events_url": "/v1/scans/scan_01JB…/events"
}
```

| Field | Notes |
|---|---|
| `depth` | `lean` (free, ~5 queries/10 pages) · `standard` (paid) · `deep` (paid, Repair). Server overrides based on entitlement — **the client requests, the server decides.** |
| Self-lookup | For `verification_tier != "anonymous"`, `full_name` must match the profile within an edit-distance threshold or the API returns `403 self_lookup_required` |

Rate limits: anonymous 1/device/30d · free 1/30d · plus 1/7d (+3 manual/mo) · business daily.

### `GET /scans/{id}/events` — SSE
```
event: stage
data: {"stage":"serp","label":"Searching Google","status":"active","progress":0.15}

event: stage
data: {"stage":"serp","label":"Found 14 results","status":"done","progress":0.30,
       "detail":{"artifacts_found":14}}

event: stage
data: {"stage":"brokers","label":"Scanning 47 data brokers","status":"active","progress":0.62}

event: complete
data: {"scan_id":"scan_01JB…","score":68,"confidence":0.81,
       "needs_review_count":7}

event: error
data: {"code":"provider_degraded","partial":true}
```
Stages, in order: `expand` · `serp` · `profiles` · `news` · `reviews` · `brokers` · `resolve` · `classify` · `score` · `plan`.

Reconnect with `Last-Event-ID`. If SSE is unavailable (some corporate networks), the client falls back to polling `GET /scans/{id}` at 2s.

### `GET /scans/{id}`
```json
{
  "id": "scan_01JB…",
  "status": "complete",
  "created_at": "2026-10-27T14:03:00Z",
  "score": 68,
  "band": "fair",
  "score_version": "1.0",
  "confidence": 0.81,
  "confidence_label": "high",
  "narrative": "You have a clear professional presence…",
  "previous": { "scan_id": "scan_01J9…", "score": 61, "delta": 7 },
  "factors": [
    {
      "key": "visibility",
      "name": "Visibility & Ownership",
      "score": 71,
      "band": "good",
      "weight": 0.316,
      "contribution": 22.4,
      "reason": "You appear on page 1, and about half of those results are yours.",
      "locked": false,
      "artifact_ids": ["art_…", "art_…"]
    },
    { "key": "sentiment",  "name": "Sentiment & Risk", "...": "…" },
    { "key": "reviews",    "name": "Reviews", "score": null,
      "excluded": true, "excluded_reason": "No review surface applies to you" },
    { "key": "coverage",   "...": "…" },
    { "key": "social",     "...": "…" },
    { "key": "privacy",    "...": "…" }
  ],
  "needs_review_count": 0,
  "artifact_count": 23,
  "next_scan_available_at": "2026-11-26T14:03:00Z"
}
```

**The three confidence renders** (`mobile-app-spec.md` §2.6) are driven entirely by this payload:
- `confidence ≥ 0.7` → `score` is an integer
- `0.4–0.7` → `score` is an integer, `confidence_label: "low"`
- `< 0.4` → **`score` is `null`**, `confidence_label: "insufficient"`, `narrative` explains it

Clients must handle `score: null` as a first-class state. A client that renders `0` for `null` is a bug that ships a lie.

For free users, locked factors return `"locked": true` with `score`, `reason`, and `artifact_ids` omitted.

### `GET /scans` — history
```json
{ "data": [ { "id":"…", "created_at":"…", "score":68, "band":"fair",
              "delta":7, "annotations":["Published bio"] } ],
  "next_cursor": null }
```

---

## 4. Artifacts (evidence)

### `GET /scans/{id}/artifacts?factor=visibility&cursor=…`
```json
{
  "data": [{
    "id": "art_01JB…",
    "url": "https://linkedin.com/in/jensenadoni",
    "domain": "linkedin.com",
    "favicon_url": "https://…",
    "title": "Jensen Adoni — VP Engineering, Acme Health",
    "snippet": "Chicago-based engineering leader…",
    "surface": "google_organic",
    "serp_position": 1,
    "published_at": "2024-03-02",
    "labels": {
      "ownership": "owned",
      "content_type": "profile",
      "sentiment": 0.6,
      "severity": 0,
      "authority": 0.92,
      "prominence": 1.0
    },
    "match_confidence": 0.97,
    "impact": { "factor": "visibility", "points": 8.2, "direction": "positive" },
    "reason": "This is your LinkedIn profile, ranking first for your name.",
    "actions": ["not_me", "dispute", "open"]
  }],
  "next_cursor": "…"
}
```

### `GET /scans/{id}/review-queue` — the "Is this you?" cards
```json
{ "data": [ { "id":"art_…", "title":"…", "snippet":"…", "domain":"…",
              "serp_position":6, "match_confidence":0.58,
              "why_shown":"Mentions your name and city, but not your employer" } ] }
```

### `POST /artifacts/{id}/decision`
```json
→ { "decision": "mine" }          // mine | not_mine | unsure
← { "score": 71, "delta": 3, "confidence": 0.88, "remaining_in_queue": 6 }
```
**Returns the recomputed score synchronously** so the deck can animate the change behind the cards. This is what makes the confirmation step feel consequential rather than like data entry.

### `POST /artifacts/{id}/disputes`
```json
→ { "reason": "inaccurate", "details": "This is a different Jensen Adoni." }
← { "id": "dsp_…", "status": "submitted", "sla_days": 3 }
```

### `GET /disputes` · `GET /disputes/{id}`

---

## 5. Plan

### `GET /scans/{id}/plan`
```json
{
  "total_potential_points": 25,
  "completed_points": 7,
  "actions": [{
    "id": "act_01JB…",
    "type": "create_bio",
    "title": "Create an authoritative biography",
    "description": "Publish a factual biography with your profession, credentials, and public contact details.",
    "priority": "high",
    "effort": "low",
    "predicted_lift": 7,
    "affects_factors": ["visibility", "coverage"],
    "status": "not_started",
    "cta": { "kind": "content_studio", "params": { "content_type": "online_bio" } },
    "steps": ["Gather your role, credentials and achievements",
              "Generate a draft", "Publish to your goodname page"]
  }]
}
```

`cta.kind` ∈ `content_studio` · `connect_accounts` · `broker_removal` · `removal_wizard` · `scan_schedule` · `review_request` · `external_link` · `upsell_repair`.

### `PATCH /plan/actions/{id}` — `{ "status": "done" | "dismissed" }`

**Auto-completion:** when a re-scan detects the artifact an action called for, the server flips `status` to `done`, sets `auto_detected: true`, and emits an alert. The client celebrates it with the realized point delta.

---

## 6. Content generation

### `POST /content/generate` — SSE streaming
```json
→ {
  "content_type": "online_bio",
  "subject": "individual",
  "tone": "professional",
  "inputs": {
    "name": "Jensen Adoni",
    "role": "VP of Engineering at Acme Health",
    "achievements": ["Led the platform rebuild…"],
    "location": "Chicago, IL",
    "credentials": ["MS Computer Science, UIUC"]
  },
  "target_length": "medium"
}
```
```
event: token
data: {"text":"Jensen Adoni is a "}

event: complete
data: {"draft_id":"drf_01JB…","word_count":184,
       "grounding":{"facts_used":5,"facts_invented":0}}
```

**Refusal is a first-class response**, not an error to swallow:
```
event: refused
data: {"code":"generation_refused",
       "user_message":"We can only write a press release about something that actually happened. Add a real event and date.",
       "reason":"no_verifiable_event"}
```
Refusal reasons: `no_verifiable_event` · `fabricated_review` · `unverifiable_claim` · `third_party_subject` · `defamatory_content`.

These guardrails are the difference between a legitimate product and an SEO-spam machine, and the FTC's 2024 fake-review rules make the `fabricated_review` case a civil-penalty matter, not a style preference.

### `GET /drafts` · `GET /drafts/{id}` · `PATCH /drafts/{id}` · `DELETE /drafts/{id}`
### `POST /drafts/{id}/revise`
```json
→ { "instruction": "shorten" }   // shorten | lengthen | retone:warm | regenerate
```

---

## 7. Publishing

### `GET /publish/destinations`
```json
{ "data": [
  { "id":"goodname_page", "name":"Your goodname page", "status":"available",
    "url":"https://goodname.co/jensen-adoni", "requires_plan":null },
  { "id":"linkedin", "name":"LinkedIn", "status":"not_connected",
    "connect_url":"/v1/me/accounts/linkedin/connect" },
  { "id":"press_wire", "name":"Press distribution", "status":"available",
    "price":{"amount":9900,"currency":"USD"}, "requires_plan":"plus" }
]}
```

### `POST /publish`
```json
→ { "draft_id":"drf_…", "destination":"goodname_page", "confirm":true }
← { "id":"pub_…", "status":"published",
    "url":"https://goodname.co/jensen-adoni",
    "indexed_check_at":"2026-11-03T00:00:00Z" }
```
`confirm: true` is mandatory. A publish request without it returns `400` — **there is no path to accidental publishing.** Paid destinations additionally require `Idempotency-Key`.

### `GET /profile-page` · `PUT /profile-page`
```json
{ "slug":"jensen-adoni", "headline":"…", "bio":"…", "photo_url":"…",
  "links":[…], "credentials":[…], "visibility":"public",
  "custom_domain":null, "schema_markup":true }
```

---

## 8. Monitoring & alerts

### `GET /alerts?unread=true&cursor=…`
```json
{ "data":[{
    "id":"alr_…",
    "type":"new_negative",
    "title":"A new result about you appeared on page 1",
    "body":"A complaint-board thread now ranks #7 for your name.",
    "artifact_id":"art_…",
    "score_impact":-4,
    "created_at":"…",
    "read":false,
    "cta":{"kind":"removal_wizard","params":{"artifact_id":"art_…"}}
  }],
  "unread_count":3 }
```
Types: `new_negative` · `new_result` · `position_change` · `score_change` · `new_review` · `rating_drop` · `broker_relisted` · `profile_change` · `scan_complete` · `dispute_resolved`.

### `POST /alerts/{id}/read` · `POST /alerts/read-all` · `POST /alerts/{id}/mute-source`

### `GET /monitoring` · `PUT /monitoring`
```json
{ "enabled":true, "frequency":"weekly", "next_scan_at":"…",
  "notify":{ "new_negative":true, "score_change":true, "plan_nudge":false },
  "quiet_hours":{"start":"22:00","end":"07:00","tz":"America/Chicago"} }
```

---

## 9. Privacy & removal

### `GET /brokers`
```json
{ "summary":{"total_checked":47,"listed":12,"removed":3,"pending":4},
  "data":[{ "id":"brk_…","name":"Spokeo","domain":"spokeo.com",
            "status":"listed","listing_url":"https://…",
            "removable":"automated","last_checked":"…",
            "requires_plan":"plus",
            "manual_instructions_url":"https://goodname.co/guides/spokeo" }] }
```
`manual_instructions_url` is present for **every** broker regardless of plan — free users can do it themselves. Gating knowledge the user could find for free is the behavior that gives this industry its reputation.

### `POST /brokers/{id}/remove` → `{ "status":"requested","eta_days":14 }`
### `POST /brokers/remove-all` *(plan-gated)*

### `GET /removal-requests` · `POST /removal-requests`
```json
→ { "artifact_id":"art_…", "channel":"google_results_about_you",
    "reason":"personal_info" }
← { "id":"rem_…","status":"drafted",
    "prefilled":{ "url":"…","reason":"…","form_url":"https://…" },
    "note":"Google's removal tool is free. We prepare and track the request." }
```
Channels: `google_results_about_you` · `google_legal_removal` · `site_owner_outreach` · `dmca` · `gdpr_erasure`.

---

## 10. Business mode

### `GET /business/locations` · `POST /business/locations`
### `GET /business/reviews?location_id=…&rating=lte:3&responded=false`
```json
{ "data":[{ "id":"rev_…","platform":"google","rating":2,
            "author":"M. Rivera","text":"…","created_at":"…",
            "responded":false,"response":null,
            "sentiment":-0.7,"topics":["wait_time","billing"] }] }
```
### `POST /business/reviews/{id}/reply`
```json
→ { "text":"…","confirm":true }
← { "status":"posted","posted_at":"…" }
```
Posts via the Google Business Profile v4 API. Requires an OAuth grant with `business.manage` from a verified owner/manager on an approved Cloud project — **apply early, approval is manual and slow.**

### `GET /business/competitors` · `PUT /business/competitors`
### `POST /business/review-requests`
```json
→ { "location_id":"…","channel":"sms","recipients":["+1…"],"message":"…" }
```
Server-side guardrail: no incentive language, no rating steering, rate-limited per location. Requesting reviews is legal; steering them is not.

---

## 11. Billing

### `GET /plans`
```json
{ "data":[{ "id":"plus_monthly","name":"Plus","price":{"amount":999,"currency":"USD"},
            "period":"month","store_product_id":{"ios":"co.goodname.plus.monthly",
            "android":"plus_monthly"},"features":[…] }] }
```

### `POST /billing/receipt` — server-side receipt validation
```json
→ { "store":"app_store","receipt":"…","product_id":"co.goodname.plus.monthly" }
← { "plan":{"tier":"plus","renews_at":"…","store":"app_store"} }
```
Apple App Store Server Notifications and Google RTDN webhooks keep entitlement authoritative server-side. **The client never decides entitlement** — it reads `me.plan`.

### `POST /billing/restore` · `GET /billing/portal` *(web/Stripe only)*

---

## 12. Account & data

### `POST /me/export` → `{ "status":"queued","notify":"email" }` (JSON + PDF)
### `DELETE /me`
```json
→ { "confirm":"DELETE","reason":"no_longer_needed" }
← { "status":"scheduled","purge_at":"2026-11-26T…","cancellable_until":"…" }
```
In-app deletion is mandatory on both stores. 30-day grace, then hard purge.

---

## 13. Push payloads

**iOS (APNs)**
```json
{ "aps": { "alert": { "title":"Your score went up 6 points",
                      "body":"Removing 2 broker listings paid off." },
           "sound":"default","badge":1,"thread-id":"score" },
  "deeplink":"goodname://score","alert_id":"alr_…","type":"score_change" }
```

**Android (FCM)** — same `data` block, channel `score`. Channels: `alerts` (high), `score` (default), `marketing` (low, separately mutable).

---

## 14. Non-functional

| | Target |
|---|---|
| Scan latency | p50 35s, p95 75s, hard timeout 120s → partial result |
| API latency | p95 < 300ms for reads |
| SSE | Heartbeat every 15s; resume via `Last-Event-ID` |
| Availability | 99.5% MVP |
| Provider degradation | SERP provider down → `503 provider_degraded` with `partial: true`; return what resolved and mark the scan `partial`, never fabricate |
| Forced upgrade | `426` + `{"min_version":"1.2.0","store_url":"…"}` when `X-Client` is below the floor |
| PII in logs | Never log `full_name`, email, or artifact URLs at info level |
| Retention | Scan snapshots 24 months; raw fetched page content 30 days |

---

## 15. Open contract decisions

1. **Does `POST /artifacts/{id}/decision` recompute synchronously or async?** Spec'd as synchronous for the animation. If p95 exceeds ~400ms, switch to optimistic client-side estimate + reconcile.
2. **Score version transitions** — when weights change, does history re-render under the new version, both, or stay pinned? Recommend: pin history, show a one-time explainer banner.
3. **Anonymous scan retention** — how long does an unclaimed `dev_…` scan survive? Recommend 30 days, then purge.
4. **Partial scans and scoring** — if the broker scan fails, do you score without `s₆` and renormalize (consistent with the excluded-reviews rule) or hold the score? Recommend renormalize + flag.
