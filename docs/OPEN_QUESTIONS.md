# Open Questions

Unresolved decisions, with what each one blocks and what I have assumed in the
meantime so work could continue.

---

## Needs your decision

### OQ-1 — Reconcile or replace the scoring model?
**Blocks:** finalising `SCORING_SPEC.md`; any score shown to a customer.

The brief's five dimensions cannot represent harmful content, which is the
problem this audience pays to solve. I have implemented the reconciled
seven-dimension model (PD-002), restoring Reputational Risk and Privacy
Exposure from the existing engine spec.

**Assumed meanwhile:** reconciliation, version `2.0.0-draft`.

### OQ-2 — Is the existing Expo app harvested or retired?
**Blocks:** Phase 8 planning; whether `goodname-app` stays in this repository.

35 screens exist for a consumer/SMB audience that is not the new target.
Worth keeping: the theme tokens and contrast test, the API contracts, the
design system. Out of scope: reviews, locations, brokers.

**Assumed meanwhile:** paused, nothing deleted (PD-005).

### OQ-3 — Which search data provider?
**Blocks:** everything past fixtures.
**Research done — see `docs/SEARCH_PROVIDERS.md`. The decision is yours.**

Prices checked from the providers' own pages, 30 Oct 2026. An audit is 3
search calls: $0.0018 at DataForSEO Standard, $0.006 at DataForSEO Live,
$0.03 at SerpApi Production. A 17x spread.

Two findings changed the picture:

**Search cost is not a margin question.** At $750-$2,000 a month per customer,
provider cost is about 0.004% of the subscription. It only bites on the free
tier, and even the dear option is ~$30 per thousand free audits.

**The cheap option cannot be synchronous.** DataForSEO Standard averages five
minutes. That is what drove OQ-11, now resolved.

**Recommendation:** trial DataForSEO on its $50 minimum, and get written
commercial terms from both before committing. Neither published terms covering
our use - redistributing derived analysis to a paying third party - and that
matters more than the price difference.

### OQ-4 — Who verifies that an audit is a self-lookup?
**Blocks:** launching the free audit publicly.

The product is built around people assessing themselves. Nothing currently
stops someone entering another person's name. Options: identity verification
before the first scan, email-domain corroboration, or rate-limit plus
attestation. Each trades conversion against misuse.

**Assumed meanwhile:** validation only. Not safe to launch publicly as is.

### OQ-5 — Severity assignment: who signs off?
**Blocks:** showing a Risk score to a paying customer.

Severity drives caps, and a cap is the most consequential number in the
report. The keyword baseline is deliberately conservative and abstains when
unsure, but it should not be the last word on whether someone's record is
described as a sanction.

**Assumed meanwhile:** the classifier abstains (`uncertain`) on anything
hedged, and abstentions carry no penalty.

### OQ-11 — The audit runs synchronously — *resolved 2026-10-30*
Moved into a background job. `POST /api/audit` now creates a pending scan,
queues the work and returns a scan id in about 25ms; the client polls
`/api/scan/[id]/status`. Retries use exponential backoff and a job that has
sent anything outward is never retried. See `packages/persistence/src/jobs.ts`.


### OQ-16 — The review queue has no staff login — *resolved 2026-11-01*
Reviewers now sign in with their own address, passwordless, against their own
staff row. `REP_REVIEWER_ID` is gone: it was one shared identity per
deployment, which looked like per-person attribution and was not.

The rule that makes it safe is the one reversed from customer sign-in:
**verifying a code never creates a member of staff.** A code is only issued
against a staff row that already exists and is not disabled, so there is no
path from "can receive mail" to "can read other people's evidence". Reviewers
are created on the server with `npm run staff -- add <email>`.

Staff sessions are a separate cookie over a separate table and last 12 hours
rather than 30 days. Disabling a reviewer revokes their live sessions in the
same transaction, and the session lookup requires an active staff row anyway.

A code request answers identically whether the address is staff, is throttled,
or is nobody — the same rule as 16g, applied to a list (who works here) that is
worth as much to an attacker as the customer list.

See `packages/persistence/src/staffAuth.ts` and
`apps/website/src/server/reviewer.ts`.

**Still open underneath it:** OQ-14. With no mail provider, a reviewer's code
reaches them the same way a customer's does — through the development outbox,
which fails closed in production. Until a provider is wired in, nobody can
sign in to a production deployment at all.

### OQ-17 — Two account deletions were failing outright — *fixed 2026-11-01*
Found while building retention, not reported by anyone.

`deleteAccount` did not delete `jobs` or `review_decisions`, and both hold a
foreign key to `accounts`. The effect was not a leftover row: the constraint
refused, the transaction rolled back, and the customer's deletion request
failed with **nothing removed**. The `jobs` case applied to every account that
had ever run an audit through the site, which is all of them — and that
table's payload holds the name, employer and city we searched for.

`ACCOUNT_OWNED_TABLES` is now exported and a test holds it against the schema,
so the next table with an `account_id` fails the suite rather than a customer.

### OQ-14 — No mail provider, so no code can reach anyone
**Blocks:** public launch.

Sign-in works, but `OutboxDeliverer` writes the message to a table and returns
`delivered: false`. A development endpoint exposes the code, guarded on both
the build mode and the deliverer not really sending — so wiring a real
provider closes it automatically rather than relying on someone remembering to
delete a file.

Needs a provider chosen on deliverability, not price: a sign-in code in a spam
folder is an account nobody can reach.

**Assumed meanwhile:** the interface says plainly that no email was sent and
shows the code.

### OQ-15 — The third verification tier does not exist
**Blocks:** anyone legitimately auditing three or more names.

`connected_account` is defined and unreachable, so a third distinct name is
refused outright. That is the safe failure, but it is a wall rather than a
step: someone who has changed their name twice has no way through.

**Assumed meanwhile:** refused, with a message explaining why.

### OQ-20 — The web account routes deviate from the mobile contract
**Blocks:** nothing. Recorded so the difference is a decision rather than a
discrepancy somebody finds later.

`api-contract.md` section 12 specifies `POST /me/export` returning
`{"status":"queued","notify":"email"}`, and `DELETE /me`. The website
implements `GET /api/account/export` as a direct download and
`POST /api/account/delete`.

The export difference is forced: a queued export notified by email cannot
work while OQ-14 stands, and a request that silently goes nowhere is worse
than a synchronous file. The verb and path differences are the website using
its own route shape rather than the mobile API's.

The grace period, the cancellation window and the `confirm: "DELETE"` body
all follow the contract, because those are the parts that are product
decisions rather than transport.

**To settle when the mobile API is real:** either the website calls the same
endpoints, or the contract gains a web section saying why it does not. Not
worth deciding now, because there is no mobile client (PD-005).

### OQ-18 — Special-category detection is lexical, not a classifier
**Blocks:** nothing today. Becomes urgent the day a real search provider runs.

`engine/sensitive.ts` decides whether a result touches health, faith,
politics, orientation, ethnicity, union membership or immigration status by
matching topic words against attributive and professional-context phrases. It
is the same shape as `classify.ts` and has the same ceiling: it cannot read
implication, euphemism or any language it was not written for, and a miss is
the direction that costs someone something.

The handling is deliberately stronger than the detection. A tripped result
loses its title and excerpt before storage, so a false positive costs an
excerpt the reader can still click through to, while a false negative is the
only way sensitive text reaches the database. That asymmetry is what makes a
blunt detector acceptable in the meantime — not a claim that the detector is
good.

What a model classifier has to do better: attribution ("his diagnosis" versus
"a diagnosis"), inference from context rather than vocabulary, and languages
other than English. The interface it must satisfy is already fixed —
`assessSensitivity(title, excerpt)` returning categories, signals and a
withhold decision — so swapping the implementation changes one file.

**Assumed meanwhile:** the filter is a floor, not a guarantee. Nothing in the
product tells a customer that their results were checked and found clean,
because that is a claim this cannot support.

### OQ-19 — A finding and a special category in the same story
**Blocks:** nothing yet. Needs an answer before real press results are stored.

A newspaper covering a conviction that also mentions the person's illness is
one document carrying both the thing we exist to report and the thing we
refuse to hold. The two rules point in opposite directions, and there is no
version that satisfies both: withholding suppresses a real finding, and not
withholding repeats a health disclosure.

Settled so far: an **official record is never withheld**. A determination is
Article 10 material, the product's whole purpose, and in practice a court
order rarely doubles as a health story. That carve-out is implemented and
tested.

Unsettled: the non-official mixed story. A single non-official source only
ever produces an allegation, so withholding it suppresses an allegation
rather than a finding — which is a smaller loss, and the current behaviour.
But two independent outlets can corroborate an allegation into a finding, and
at that point withholding both would hide something real.

Options, none of them free:
  - Withhold the excerpt but keep the finding, citing the source without
    quoting it. Keeps both, at the cost of a finding the reader cannot see
    the words behind.
  - Withhold entirely and accept the suppression. Simple, and occasionally
    wrong in the direction that matters to a customer.
  - Route it to a human, which is the one case where sending a reviewer to
    the source might be justified — and needs OQ-6's answer first.

**Assumed meanwhile:** withheld, and therefore excluded from risk. The
conservative option, chosen on the grounds that the alternative is this
product repeating someone's medical history, and recorded here rather than
left to be discovered.

---

## Needs legal review

### OQ-6 — Regulatory posture of the audit
Self-lookup framing does not by itself resolve obligations. Needs review of
FCRA exposure, state privacy law, professional advertising rules for attorneys
and physicians, and consumer-protection rules on claims.

### OQ-7 — Correction and removal workflows
Drafting requests on a customer's behalf, and tracking responses, touches on
unauthorised practice of law in some states. Scope needs counsel before
Module F ships.

---

## Needs product input

### OQ-8 — Commercial name
Provisional internal name only. Branding is one configuration value.

### OQ-9 — What exactly is "up to four content assets"?
The Executive tier promises four assets a month. Without a definition of an
asset, delivery cost is unbounded. Needs word counts, revision limits and an
out-of-scope list before the price is quoted to anyone.

### OQ-10 — Mobile billing
Whether subscriptions are sold in-app at these prices, or purchased on the web
with the app reading entitlement. Current Apple and Google policies need
checking against the intended flow before anything is built.

**Assumed meanwhile:** entitlement is read from the server, never granted on
device.

---

## Resolved

### OQ-R1 — Package manager — *resolved 2026-10-29*
npm workspaces. pnpm and Turborepo are not installed and the brief conditioned
them on environment support. See PD-001.

### OQ-R2 — Can the first slice run without Supabase? — *resolved 2026-10-29*
Yes. Domain logic is pure and persistence sits behind an interface. See PD-003.

### OQ-21 — Scoring a presence we were paid to build
**Blocks:** selling any managed service alongside the audit.

The audit scores someone's online presence. The proposed service improves
it. If the service publishes pages for a customer and the audit then counts
them, the company is marking its own homework and selling the mark.

The engine already refuses the crudest version of this: `dedupe.ts` clusters
syndicated copies and risk counts clusters rather than documents, so one
release reprinted twenty times is one story. That handles corroboration. It
does not handle authorship, which is the part that matters here — a cluster
of one is still a cluster, and `sourceType: 'press'` says nothing about who
wrote it or who paid for its distribution.

**The distinction is not who pressed publish.** It is who controlled the
content, whether anybody exercised editorial judgement, and what was
actually observed in a search result. A piece we drafted that an editor
accepted is not the same as a release we syndicated to twenty sites, and
neither is the same as the customer's own site.

**Proposed, not implemented.** Evidence gains provenance beyond
`sourceType`: who owns it, who created it, how it was distributed (owned,
paid, syndicated, editorial), whether editorial independence was verified,
and which engagement produced it. Then three rules:

  - **Publishing is not discoverability.** A live page is not an indexed
    page and an indexed page is not a visible one. Discoverability counts
    what was observed in results, never the publishing ledger.
  - **Source authority cannot be bought through our own pipeline.**
    Anything we created or distributed is excluded from it, whatever it
    looks like.
  - **The intervention is never hidden.** A customer's own report
    distinguishes organic third-party results from material we placed.

A fourth, which is the one that stops the score flattering us: **keep the
pre-engagement baseline and the methodology version with it.** Otherwise a
later change to weights or classification is indistinguishable from work
having been done.

**Assumed meanwhile:** no managed service is sold, so nothing is
mis-scored. This has to be built before the first engagement, not after.

### OQ-22 — Is a paid vanity placement a buying signal?
**Blocks:** committing to an acquisition motion.

Somebody who has paid for a Who's Who or similar placement has
demonstrated they will spend money to look better online, which makes them
a plausible first customer and an easy one to find.

The counter-argument is worth recording rather than dismissing: a vanity
placement may be a one-off purchase made on feeling, or one the buyer was
disappointed by, and neither implies an appetite for ongoing management.
Prior spending establishes willingness to pay for recognition, not for this.

**To settle empirically, not by argument:** three groups of ten — recent
paid placement, same profession with no known placement, and placement plus
an observable presence problem — with the offer held constant. The measure
is qualified meetings and deposits, not replies.

**Assumed meanwhile:** a prospecting signal, not a validated segment, and
never the content of the approach. Opening by implying we know what
somebody paid for, or that it was wasted, is both poor selling and exactly
the behaviour this product is supposed to be the opposite of.

### OQ-23 — What the service costs, and what it may claim
**Blocks:** quoting anybody.

No price exists. The working hypotheses from the strategy discussion are a
fixed-scope engagement in the region of a four-figure sum, with an optional
monitoring retainer after it — both explicitly test prices to find out what
somebody will actually buy, not a rate card.

Two decisions are more important than the number:

**Not per asset.** Charging per published item creates a reason to publish
things that add nothing, which is how this category earned its reputation.

**Not a recurring automated scan.** A retainer has to carry enough review
and accountability to be worth renewing; otherwise it is a subscription to
a cron job.

**Unknown until measured:** actual delivery hours including revisions,
approval delays, publishing failures and support. The margin arithmetic is
guesswork until three engagements have been delivered and timed.

**Assumed meanwhile:** nothing is quoted and no price appears anywhere in
the product.

### OQ-24 — Identity confidence was confidently wrong — *fixed 2026-11-05*
Found by running the product, not by reading it: a report headed with one
name, scoring 59, built from six results of which five were explicitly
somebody else, and labelled **Identity: high**.

The cause was one filter in `identityConfidence`:

```ts
const named = records.filter((r) => r.identityConfidence > 0);
```

Intended as "results that bear the name". Behaved as "results we did not
reject", because a rejection scores exactly zero. The average was then
taken over the matches, which is to say it could not fall. The comment
four lines above it claimed the opposite.

**The deeper fault was the metric, not the filter.** One number was
answering two questions — how much of what we found is about this person,
and how sure we are of the part that is — and reporting only the second.
It is now the product of both, because both have to hold. One confident
match among five contradictions is not a confident report, and five
tentative matches with nothing against them is not one either.

Prominence now weights the share rather than the verdict. A wrong-person
result at position one contests more than one at position thirty: that is
a statement about how much it matters, not about whether it is them.

**A behaviour change worth stating, because it is a demotion.** The
flagship scenario moved from `high` to `moderate` (0.78). Three of its
five attributed results are only *probable*, so the report genuinely is
not high-confidence until the customer confirms them — and confirming
them now moves the figure, which is what the "Is this you?" prompt was
always supposed to be for. Tuning the thresholds to keep the old answer
was available and is exactly the thing rule 9 forbids: adjusting a score
so the product looks better.

**Still unresolved, and inherited:** none of this is calibrated. The bands
at 0.85 and 0.60 are product rules, not measured ones, and the question
of what a 0.78 means remains open until there is a labelled set of correct
and incorrect matches to measure against. The fix makes the number move in
the right direction; it does not make it a probability.

### OQ-25 — The customer's own words on somebody else's domain
**Blocks:** nothing today. Misstates Source Authority for founders now.

Found by building the founder fixtures, which is what they were for.

`founder_self_published` scores Source Authority at **71**, explained as
"3 independent pieces of earned coverage". The three are a podcast episode
he appeared on, a guest column he wrote for somebody else's publication,
and a funding story a reporter wrote. Only the third is independent. The
other two are the founder's own words, hosted elsewhere.

The engine cannot see the difference. Both sit on third-party domains,
both carry `sourceType: 'press'`, and the classifier calls them `earned`
because that is what they look like. OQ-21's authorship model handles the
case where **we** placed something; it has nothing to say about material
the **customer** placed, and the default — third party, editorial — is
wrong for exactly this shape of evidence.

This matters most for the audience it matters least to be wrong about.
Attorneys and physicians are mostly written about. Founders mostly publish:
a company page, a personal site, a profile, a podcast, a column. A model
that reads all of that as independent regard rates somebody as well-thought-of
for having a blog.

**Three ways out, none free.**
  - **Ask.** The report already asks "is this you?" for identity. "Did you
    write this?" is the same shape of question and the customer is the only
    one who reliably knows. Costs a second decision per record.
  - **Detect it.** "joins the show", "guest post", "writes about" are
    plausible markers and this is a lexical classifier with the same
    ceiling as `classify.ts` and `sensitive.ts` — and a false positive here
    deletes real coverage from somebody's score.
  - **Weight by source instead.** Treat podcast and guest-column domains as
    a lower authority tier regardless of who wrote the words. Cruder, needs
    no new input, and wrong for a genuine interview.

**Assumed meanwhile:** the figure is reported as it stands, the fixture
exists so the gap is reproducible rather than theoretical, and no keyword
guesser has been added on the strength of one example.

### OQ-26 — The US launch gates, and how few of them are engineering
**Blocks:** taking money from a US customer.

A go-to-market audit on 5 November produced a gate list for one US
customer. Ten gates. **One is engineering.**

| | Gate | Type |
|---|---|---|
| 1 | One customer state, profession, exact service scope | Decision |
| 2 | Who legally sells it, entity, registration | Decision + lawyer |
| 3 | FCRA, privacy, outreach and advertising review for that scope | Lawyer |
| 4 | Service agreement, disclosures, refund terms, authorisation | Lawyer |
| 5 | A lawful outreach process | Decision + lawyer |
| 6 | Price, deposit terms, acceptance criteria | Decision |
| 7 | A payment method | Purchase |
| 8 | Authorisation, intake, data handling, retention | Decision + build |
| 9 | Verified delivery automations and approval steps | Build |
| 10 | The deliverables themselves | Operations |

The audit platform, public hosting, transactional email and the mobile
apps are **not** prerequisites for any of it.

**The distinction that carries the most weight** is between three
activities that are not equivalent risks: selling a service to somebody
about their own assets; preparing an assessment about an identifiable
person; and distributing a reusable report that others might use to make
decisions about them. The first customer should be the first activity,
with a narrow version of the second, and the third refused entirely.

**What is for counsel, specifically.** Whether the first-customer
workflow raises consumer-reporting-agency questions and what must stay
excluded; which privacy laws apply given the entity, states and
processing; what is required to publish material about a verified
customer; outreach and lead-source restrictions; and the advertising
rules of the customer's own profession, which are state bar and state
board matters rather than federal ones.

**Assumed meanwhile:** nothing is sold, the site stays `noindex`, and no
report is prepared about anybody who has not asked for one.

### OQ-27 — Scope limits are only real where they leave the screen — *partly closed 5 Nov 2026*
**Blocks:** nothing. Reduces a real exposure.

The product has always refused the regulated uses by not building them —
no employment screening, no tenant screening, no credit or insurance
eligibility feature exists anywhere in it. That absence is the genuine
safeguard and it protects nobody once a report leaves the screen.

A printed report is a document about an identifiable person with a number
on it. A JSON export is the same thing, forwarded more easily. Whoever
opens either one did not see the interface, agreed to nothing, and has no
way to know what it was for.

**Closed:** `PERMITTED_USE` is one sentence in the domain, rendered first
in the report's limitations, carried as the first key of every data
export, and held open on paper by the print stylesheet. Tests assert all
three, and that it names the decisions rather than only the category —
"not a background check" is arguable, "employment, credit, housing,
tenancy, insurance" is not.

**Still open:** this is a product boundary, not a legal opinion, and
stating a limitation is not the same as the limitation holding. Whether
it changes the analysis at all is part of what OQ-6 and OQ-26 have to
ask.

---

### OQ-28 — `audit_attempts` held names that no account owned — *closed 5 Nov 2026*
**Blocked:** nothing today. Would have blocked holding real data at any volume.

Every other table carrying a person's details is scoped to an account, so
a deletion request reaches all of it. `audit_attempts` is not. It is keyed
on a requester id, because its job is to notice one requester working
through a list of different names, and that question cannot be asked from
inside a single account.

Two things make it smaller than it first looks. A refused attempt is never
recorded — `gate()` writes the row only after every check passes — so a
request we turned down leaves no trace of the name. And the gate caps a
requester at two distinct names, so the table holds at most two per
requester, both of which that person attested were their own.

What is still true, and the sharper half of it: `SqliteAttemptStore` has a
`prune(olderThanIso)` method, with a test, **and no caller anywhere in the
application.** `enforceRetention` does not touch the table. So the rows are
not covered by `ACCOUNT_OWNED_TABLES`, nothing ages them out, and a
customer who deletes their account leaves their name in this table
indefinitely. This is the same shape as the defect rule 16af was written
for: the capability exists, is tested, and nobody can exercise it.

The row also stores the whole `purpose` blob as JSON, which carries the
attestation text and timestamp.

**Closed, three ways.**

*A period, in the file where every other period lives.* `attemptDays: 30`,
swept by `enforceRetention` on the hourly clock. Not 1 day, which is all
the gate looks back: an attempt row is also the only record of somebody
working through a list, and that question — "has this requester been doing
this all month" — gets asked after somebody notices, not during. Not the
evidence tier either, because these names were typed by the requester
about themselves and never searched for.

*A deletion path.* `deleteAccount` now removes the rows by requester id.
Deleted rather than anonymised: the access log survives because it records
what staff did to somebody else's data, and that argument does not carry
over to a counter against a requester who no longer exists. No hole opens
— a new account gets a new id and a fresh count regardless.

*One definition of the key.* `requesterIdFor` moved to persistence, beside
the table, and the audit route imports it. The route wrote rows under one
string and deletion removes them by another; if those ever drifted, the
deletion would leave a deleted customer's name behind and nothing would
fail. Two files agreeing by coincidence is not a guarantee.

**Not done, and deliberately.** `subject_name` stays. The normalised
`subject_key` is what the counting uses, so the typed name is redundant
for the gate — but it is what an abuse review reads, and the key is a
lowercased version of the same name, so dropping the column buys very
little privacy for a real loss. It now expires at 30 days like the rest of
the row.

**The general lesson, which is the part worth keeping.** This was not a
forgotten `DELETE`. It was a table reachable by neither the deletion loop
(no `account_id`, so `ACCOUNT_OWNED_TABLES` could not see it) nor the
retention sweep, with a `prune()` method that had a passing test and no
caller — which reads from the outside exactly like a retention policy.
`retention.test.ts` now asserts the general form: every table in the
schema is covered by deletion or by retention, or is named in a list with
the reason it holds no personal data. A new table fails that test until
somebody answers the question.

Still reported to counsel in `COUNSEL_TECHNICAL_APPENDIX.md` §5, as
closed rather than open — a gap found and fixed in the same week is a more
useful thing for them to see than a gap that was never there.

---

### OQ-29 — What the first fulfillment rehearsal found — *closed 9 Nov 2026*
**Blocks:** a first paid engagement. Not the search provider decision.

`docs/FULFILLMENT_REHEARSAL.md` has the full run. Three of its eight
findings are decisions rather than tidying, so they live here.

**F1. A report cannot be opened twice.** It exists only in the tab that
produced it: no URL, no list of past audits, no link from the account
page, which says "Audits stored: 1" and offers only a JSON download. The
data survives and `/api/scan/<id>` rebuilds it; nothing ever hands the
customer that id. This is the one item on the critical path that is
engineering's to fix rather than the owner's to buy, and it is not a
small screen — it needs a decision about whether a report is a durable
artifact with an address, and what happens to that address when the
evidence behind it expires at 180 days (rule 16x already says the page
must say so rather than render empty).

**F2. The classifier reads a negation as the thing it negates.** "No
disciplinary actions are recorded against this certificate" was
classified `negative` / `confirmed_finding` / severity 3, citing the
phrase it found inside the denial. The review gate held it back from the
customer, which is what the gate is for — but the gate is a person, and
"Uphold" is the first option on the screen. The decision is whether to
handle negation in the classifier, or to treat official-source negatives
as always requiring a reviewer who is told to read for exactly this.

**F3. `Last, First` is not a name match.** `Okonkwo, Amara` scores 0.10
and is rejected; `Amara Okonkwo` scores 0.35. State bars, medical boards,
court records and academic directories publish surname-first almost
without exception, and those are the sources the score weights most. This
is the inverse of rule 11: not a false match, a true one discarded. The
decision is how much corroboration a reversed-order match should need,
given that making it cheaper makes collisions cheaper too.

F2 and F3 arrived in the same fixture and compound: the record that would
have cleared her was discarded, and the same record was reported as
misconduct. The physician scenarios have had less adversarial attention
than the attorney ones they were modelled on, and the other professions
should be assumed to be in the same state until someone looks.

**Decide:** whether these are fixed before a first engagement or managed
around it by hand. Fixing F4 — the customer's own "this is me" not
clearing a record from the staff queue — is separately worth doing first,
since it removes two thirds of the review work this engagement generated
and is a query change rather than a judgement call.

**Addendum, same day — the ordering above was wrong.** I had argued F2
and F3 were contained because the review gate holds unreviewed findings
back from the customer. The correction, and it is right: the rehearsal
showed the gate stops an *unapproved* finding reaching the customer. It
showed nothing about whether a reviewer reliably *notices* a wrong
classification — and the screen puts **Uphold** first, which makes
confirming the easiest action available. Containment by a human who is
being nudged toward agreement is not containment.

So all four are engineering's, under an explicit boundary: *the owner
decides whether GoodName offers automated audits at all; engineering
decides whether the implemented audit is safe enough to use inside
whatever scope is authorised.* Fixing a defect that violates an invariant
the product already claims is not new product scope.

Three things that change what the fix looks like:

- **No negation keyword patch.** Searching for "no", "not", "without"
  fails on harder language. The rule to implement instead: no automated
  adverse finding is `confirmed` without an explicit reviewable basis.
  Split *possible adverse content* from *confirmed adverse finding*,
  give ambiguity its own state, and make negations, resolved
  allegations, quotations and other-person references regression cases.
  Remove the preselected Uphold; make reject, uncertain and escalate
  equally reachable.
- **Do not fix F3 by lowering the threshold.** That trades a false
  rejection for a false attribution. Normalise names into components and
  accept the presentation forms (given+family, family-first, middles and
  initials, titles and suffixes, Unicode and punctuation), while keeping
  *name compatibility* distinct from *person identity* — a compatible
  name still needs corroboration for a high-impact record.
- **A fifth defect, not yet in this list and the more serious one.**
  There are three versions of the truth: the evidence stored at audit
  time, the current engine's reading of it, and the report rendered
  later. A durable report route (F1) exposes it — reopen an old audit
  after an engine change and the score, findings or risk could differ
  with no new evidence. Rebuilding on read is rule 16d and it is right
  for a live scan; it is wrong for a historical one. New engine logic
  should produce a new versioned assessment, never rewrite the old one.
  Called out as a more important safeguard than extracting the worker
  from the web process — which, separately, is not a launch dependency
  so long as jobs persist before execution, interrupted jobs are
  identifiable, retry is safe, duplicates cannot double-publish and
  staff can recover failures. The scheduled *deletion* timer is the part
  that genuinely cannot live in a process that may sleep or scale to
  zero.

Proposed milestone, 3–5 working days, then engineering stops again: the
negation regression and the unsafe Uphold default, surname-first
normalisation with corroboration tests, the authenticated durable report
route plus an account-history link, the review queue excluding
identity-only records the customer already resolved, snapshot and version
consistency across view/print/export, and one complete repeat of the
rehearsal — reopening the report in a fresh session, with an
unauthorised account, against a negated disciplinary statement and a
surname-first name.

**Closed, and verified by rehearsal 02** (`docs/FULFILLMENT_REHEARSAL.md`).

F1 is `/report/[id]`, listed on the account page. The id is not a
capability: a different signed-in account gets the same 404 a nonexistent
scan gets. F2 is structural rather than a negation patch — nothing in the
classifier emits `confirmed_finding` any more, and promotion needs either
corroboration across independent domains or a named reviewer upholding it
in writing. F3 takes names apart into components and accepts both written
orders at the same weight, without lowering what a name alone is worth.
F4 is a query: a customer's answer closes the identity question and only
that question.

The screen changed with them. Nothing is preselected, the button says
"Choose a decision" until one is made, and Uphold is last rather than
first — upholding is now the act that creates a finding about a person,
so it should be the most deliberate thing on the page.

**The fifth defect is closed too, and it is the one worth remembering.**
Reopening a report after an engine change moved the number under the
original date. Recomputation stays (rule 16d is right for a live scan);
divergence is now an event in the append-only history, with a reason
naming what moved and a line on the page. Rehearsal 02 checked it by
actually bumping the methodology version — and found that the notice
appeared once and vanished, because the page was rendering what the
reconciler had just done rather than what was true of the report. A fact
about the report is not a fact about the request that noticed it.

**F7 closed 6 November 2026.** The audit form no longer opens pre-filled
with the demo attorney's details for whoever is signed in. It arrives
empty, the fixture subjects load from a button that names the subject, the
scenario picker will not overwrite a typed name, and the attestation
states whose name is about to be searched. Fixed during the design pass
rather than the correctness milestone, which is why it was listed here as
open for a day after it was not.

**F5 and F8 closed 9 November 2026.**

F5: a reviewer's judgement now carries onto a later scan when the source
URL and the excerpt both match, within the account. The excerpt is the
load-bearing half. A reviewer read a particular sentence and decided what
it established, so if the page has been rewritten since, carrying the
decision forward would attribute to a named person an opinion they never
gave. A changed source goes back to a human. A carried decision records
which scan it was made on, because it is still one row made once by one
person, and presenting it as a fresh judgement would invent a review that
never happened.

F8: the two cases are told apart. Where the results awaiting an answer are
`uncertain` they sit outside the attribution count and answering does move
it, so the report says so. Where they are `probable` they are already
counted, and the report now says the true thing instead: answering changes
how sure we are of the count rather than the count.

**Still open, and it is the owner's.** The cost of F2: a genuine
disbarment no longer raises the risk level until a person has read it. The
same branch produced both outcomes and there is no version of it that is
confident about the real one and careful about the misread one, so the
trade is the owner's to revisit, not engineering's.

---

### OQ-30 — Which unresolved adverse records are *material*? — *opened 5 Nov 2026*
**Blocks:** promoting an unattributed adverse record to the risk headline.
Nothing else.

**The invariant, which is settled and implemented.** The report must not
imply that material adverse uncertainty has been resolved when it has not.
Whether an assessment is *finished* and whether it *found anything* are
separate facts, and "No confirmed adverse findings" was answering the
second while being read as the first.

**What is not settled, and is not engineering's to settle.** An uncertain
identity match must not contribute to somebody's risk score — that rule
stands. But a record excluded from scoring is not therefore irrelevant to
reading the score, and deciding *which* excluded records should make a
whole assessment read as pending is an attribution policy.

**Why a rule cannot be written today.** `materiality.test.ts` constructs
the two cases that any such rule must separate:

| | Hers | A stranger's |
|---|---|---|
| Title | `Okonkwo, Amara — Board certified…` | `Okonkwo, Amara — Order of suspension` |
| Source | American Board of Internal Medicine | Texas Medical Board |
| Reliability | official | official |
| Identity | uncertain · 0.35 | uncertain · 0.35 |
| Classification | negative | negative |
| Finding status | requires_review | requires_review |
| Severity | 3 | 3 |

Every field the evidence model holds is **identical**. A rule over this
record shape must promote both — one stranger's suspension holding every
namesake's assessment hostage, which is the product becoming an allegation
amplifier — or neither, which is the reassuring headline the correction
was meant to remove.

The three fields that differ are not judgements the engine can make. The
domain differs, but "abim.example is her board and tmb.example is not" is
a claim about which registries govern a Massachusetts cardiologist, and we
hold no such mapping. Rank differs, and rank is a fact about Google. The
name form differs, and inverted-name registries are not more likely to
concern the customer.

**What would resolve it.** The missing datum is a licensing jurisdiction —
the state and board a professional is actually registered with — which the
intake form does not ask for and the evidence does not carry. With it, an
order from a board the customer has never been licensed by is a different
kind of record from a certificate issued by one they are. That is also
exactly the data the `connected_account` verification tier (OQ-15) was
meant to establish.

**Decide:** whether to collect licensing jurisdiction at intake, and what
materiality means once it exists. Until then the count is reported and
never promoted.

**Done in the meantime, and deliberately bounded.** `unattributedAdverse`
is a deterministic count, kept distinguishable from `awaitingReview` in the
data, and used only in the sentence under the headline: how many records
carrying possible adverse language were set aside, that they are excluded
and unreviewed, and that they may belong to somebody who shares the name.
Stating a count is not a materiality judgement. `settled` goes false
whenever anything was set aside, so the claim of completeness is withdrawn
without the headline being promoted.

**The tripwire.** `materiality.test.ts` asserts the two records are
indistinguishable. If somebody adds the data that separates them, that
test fails and says so — which is the signal that this question can be
answered rather than deferred.
