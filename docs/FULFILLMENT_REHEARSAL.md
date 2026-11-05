# Fulfillment rehearsal 01

One engagement run end to end, 5 November 2026, against the code at `a41a5ac`.

**The question.** Not "does the audit engine work" — the tests answer that.
The question is whether a *service* can be delivered: whether one person could
take one customer from request to a deliverable in their hands, and what it
costs in human minutes when they do.

**The subject.** Amara Okonkwo, physician, Boston — a fixture, not a person.
Scenario `physician_review_complaint`: a hospital bio, a board certification
record, a patient-ratings page and a directory listing. Chosen because it is
the hardest realistic case the fixtures hold: it produces review work, identity
ambiguity and a negative-looking result that is not a finding.

**Who ran it.** One operator who wrote the system, knew every screen, and did
not read a single source document. Every number below is therefore a **floor**,
not an estimate. A real reviewer reading a real source page would take
substantially longer, and that is the point of §4.

---

## 1. What actually happened

| Leg | Clock | What it involved |
|---|---|---|
| Customer | 19:33:47 → 19:35:55 (**2m 08s**) | Sign in, run the audit, answer two identity questions |
| Review | 19:35:55 → 19:37:27 (**1m 32s**) | Staff sign-in, three flagged records, three written decisions |
| Delivery | 19:37:35 → 19:39:13 (**1m 38s**) | Retrieve the report, export the data, confirm the deliverable |
| | **5m 18s** | |

Inside those legs, the parts that were actually the work:

- **The audit itself: 0.5 seconds.** Against a fixture. Against the cheapest
  real provider this leg is around five minutes, and the architecture already
  assumes it (`docs/SEARCH_PROVIDERS.md`) — the job queue exists for this.
- **Two identity confirmations: 2.7 seconds.**
- **Three review decisions: 8.6 seconds of typing**, having read nothing.
- **Everything else was overhead**, and most of it was the operator working
  around a gap. See §2.

---

## 2. What broke

Eight findings. Three would stop a first engagement; the rest cost time or
trust.

### F1 — A report cannot be opened twice · **blocks fulfillment**

The report exists only in the browser tab that produced it. There is no URL for
it, no list of past audits, no link from the account page. `/audit` returns an
empty form. The account page says **"Audits stored: 1"** and offers no way to
open it.

The data survives perfectly — scans, evidence, snapshots, and `/api/scan/<id>`
rebuilds the report on demand — but **nothing in the product ever gives the
customer that id.** The only way to see the work again is to re-run it, or to
download raw JSON.

For a managed service this is the single largest gap. Fulfillment means handing
somebody a deliverable they can return to, forward to their own advisers, and
still have in six months. Today, closing the tab loses it.

### F2 — The classifier reads a negation as the thing it negates · **high**

The board certification record says, verbatim:

> "Certification in Cardiovascular Disease is current. No disciplinary actions
> are recorded against this certificate."

The classifier matched the phrase *disciplinary action* inside the sentence
denying it, and produced:

| Field | Value |
|---|---|
| classification | `negative` |
| finding status | `confirmed_finding` |
| severity | **3 of 5** |
| classifier's stated reason | `An official record stating "disciplinary action".` |

A clean board record, classified as the most damaging thing this system can
say about a physician.

**It did not reach the customer**, and the reason matters: the record was held
at `needs_human_review`, and unreviewed findings never reach the risk
assessment. I checked this rather than assuming it — re-running with the
identity defect in F3 corrected, so the record attributed to her, still gives
`risk level: none`. The containment works exactly as designed.

But the containment *is a person*. The review screen offers **Uphold** first,
described as "The classification is right. It stands as written." A reviewer
working at speed, trusting a classifier that cites an official source, upholds
it — and a physician is told she has a disciplinary finding. Rule 10 exists for
this and the rule held; the classifier did not.

### F3 — "Last, First" is not recognised as a name match · **high**

The same record is titled `Okonkwo, Amara — Board certified`. The matcher
scores it **0.10, rejected**, with the signal *"Only your surname appears,
which is weak on its own."*

Tested directly against the engine, changing nothing but the title:

| Title | Confidence | Status |
|---|---|---|
| `Okonkwo, Amara — Board certified…` | 0.10 | **rejected** |
| `Amara Okonkwo — Board certified…` | 0.35 | uncertain |

Professional registries overwhelmingly publish `Last, First`: state bars,
medical boards, court records, academic directories. These are the official
sources the score weights most heavily and the ones a customer most wants
found. The matcher currently rejects them as a different person.

Rule 11 says a name match is not an identity match, and that is right. This is
the opposite failure: a genuine match not recognised as one.

### F4 — A reviewer is sent to answer a question the customer already answered

The customer confirmed *"this is me"* for the Healthgrades and Doximity
results. Both remained in the staff queue, flagged **"We are not certain this
result is about the customer."**

Two of the three records a reviewer handled in this engagement were settled
before they opened them. That is two thirds of the review minutes in this run
spent on nothing — and under §6 of the appendix, a reviewer reading a customer's
evidence is the one operation in the system that crosses the account boundary.
We logged two crossings that did not need to happen.

### F5 — Review work does not survive a re-run

Re-running the same audit for the same customer re-queued all three records.
Decisions are keyed to `(scan_id, evidence_id)`, which is correct — a decision
is about one record in one scan, and rule 16r keeps the classifier's original
call beside the human's. But the consequence is that **the same classifier
error in F2 is re-queued for a human on every re-audit**, for ever, until the
classifier is fixed.

Queue after run one, decided: 0 waiting. After run two: 3 waiting, the same
three records.

### F6 — Nobody can receive a sign-in code

No mail provider, so:

- The **customer** code is printed on screen under an honest notice: *"No email
  was sent. No mail provider is configured, so nothing left the server."*
  Correct behaviour, and gated so it closes the moment a provider is wired in.
- The **staff** code is not shown anywhere. I read it out of the
  `email_outbox` table with a shell command.

In an engagement, every sign-in is an operator with database access.

### F7 — The audit form opens pre-filled with a different person

Signed in as Amara Okonkwo, `/audit` arrives pre-filled with **Jensen Adoni**,
attorney, Chicago — the demo subject. Convenient for a demo. In fulfillment it
is a form the operator must remember to clear, on the one screen where typing
the wrong person's name is the failure the whole product is built to prevent.

### F8 — A finding promises movement it cannot deliver

Finding 01 read: *"2 still need your confirmation, and answering moves this
figure."* The figure was `IDENTITY 3 of 4`. Both outstanding results were
`probable`, which already counts as attributed — so confirming them could not
move 3 of 4, and did not. Presence stayed at 61.

The finding did correctly disappear once answered, so the customer gets *some*
feedback. The sentence is still a promise the arithmetic cannot keep.

---

## 3. What held

Worth recording as precisely as the failures.

- **The gate ran in the request**, and the attestation text was stored on the
  scan rather than a boolean.
- **Fixture labelling survived to the deliverable**: a banner on screen, the
  line "Built from fixture data: nothing here describes a real person" under
  the subject's name, and `is_fixture` on the row.
- **Snapshots are append-only with stated reasons.** Three rows after this
  engagement: `initial scan`, `customer confirmed ev-003`,
  `customer confirmed ev-004`. Nothing was updated in place.
- **The access log recorded reads, not just decisions**: 9 entries — 6
  `listed`, 3 `decided:*`. The reviewer who reads and decides nothing is
  visible.
- **A decision without a rationale was refused.**
- **The export is what it claims to be**: 18 KB, `permittedUse` as the first
  key, review decisions included, no staff identifier anywhere in it.
- **Two sessions coexisted correctly.** Customer and reviewer signed in to the
  same browser, separate cookies over separate tables, 30 days against 12
  hours.
- **The misclassified finding never reached the customer.** The thing that
  caught it was the review gate, which is the thing it is for.

---

## 4. Human review minutes per engagement

ChatGPT's proposed first operating metric. This run gives a floor and not much
more, and the honest version is worth more than a flattering one.

**Measured:** 8.6 seconds of decision entry for three records, by an operator
who read no sources.

**Not measured, and dominant:** the review screen says *"Open the source — read
it before deciding."* Nobody did. Reading a board page, a ratings page and a
directory listing, and forming a defensible judgement on each, is the actual
work. On F2 specifically, the only thing that caught the error was reading the
excerpt word by word and noticing the negation — a reviewer skimming for the
phrase the classifier cited would have upheld it.

**So the number to carry forward is not 8.6 seconds.** It is: three flagged
records per engagement at this fixture's density, **two of which did not need
reviewing at all** (F4). Fix F4 and the same engagement produces one record for
review instead of three. That is the lever, and it is a code change, not
hiring.

**What to instrument before the first paid engagement:** time from queue-open
to decision per record, and the proportion of decided records that had already
been resolved by the customer. The second number should be zero and is
currently 67%.

---

## 5. What this says about readiness

**The engine is in better shape than the service.** Scoring, provenance,
retention, deletion, access logging and the review gate all did what the
specification says, including catching a classifier error before it reached a
person. Nothing in §3 was a surprise, which is what the tests are for.

**Fulfillment is not deliverable today**, and the blocker is not the search
provider. Even with a live provider connected and a customer in front of us,
F1 means there is no artifact to hand over that outlives a browser tab. That is
a product gap, not a purchasing decision — the one thing on the critical path
that is engineering's to fix rather than the owner's to buy.

**Two correctness defects are live.** F2 and F3 are both wrong answers about a
real person's professional record, in the direction that matters most: F2
invents a disciplinary finding out of a clean one, F3 discards the official
record that would have cleared it. They arrived together in one fixture, which
suggests the physician case has had less adversarial attention than the
attorney case it was modelled on.

**Not fixed in this pass, deliberately.** This document is the output of the
rehearsal. Fixing F1 through F8 is a separate decision about what to build
next, and that decision belongs with the scope and pricing questions, not with
the person who happened to find the bugs.

---

## 6. Running it again

```
find apps/website/.data -type f -delete
npm run staff --workspace @rep/website -- add ops@goodname.test reviewer
npm run dev
```

Then: sign in at `/signin` (the code is on screen), `/audit` with scenario
`physician_review_complaint`, answer the identity questions, read the staff
code out of `email_outbox`, work the queue at `/review`, and export from
`/account`.

Re-run this whole rehearsal after any change to classification, identity
matching or the review queue, and append the result as rehearsal 02 rather
than editing this one. The value is in the comparison.

---

# Fulfillment rehearsal 02

Same engagement, same subject, same operator. 5 November 2026, against
`6fc16c0` plus the milestone work. Run to check the six acceptance items
from the correctness-and-delivery milestone, not to re-measure the clock.

**4m 38s**, against 5m 18s. The number is not the point and is not
comparable: the operator was faster for having done it before, and one leg
genuinely shrank because there was two thirds less review work to do.

---

## The six items

| # | Item | Result |
|---|---|---|
| 1 | A negated disciplinary statement does not become a finding | **Passed** |
| 2 | Surname-first names are recognised | **Passed** |
| 3 | No unsafe default on the review screen | **Passed** |
| 4 | Records the customer resolved leave the queue | **Passed** |
| 5 | The report reopens, authenticated, and cannot change silently | **Passed**, after a defect found and fixed mid-rehearsal |
| 6 | One complete repeat of the rehearsal | this document |

### 1 and 2 — the board record, in the database after a live run

```
American Board of Internal Medicine
  identity_status   rejected  →  uncertain
  identity_confidence  0.10   →  0.35
  identity_signals  "Only your surname appears, which is weak on its own."
                 →  "Your name appears surname first, as registries write it."
  finding_status    confirmed_finding  →  requires_review
```

The official record about her is no longer somebody else, and is no longer
a disciplinary finding. After she confirmed it, **identity read 4 of 4**
rather than 3 of 4.

The reviewer screen now carries the classifier's own doubt:

> Classifier said: An official record where "disciplinary action" appears
> next to "no", which may reverse its meaning.

And the risk section said, with nothing yet read:

> **None found.** Nothing is established. 1 result mentions something
> adverse and has not been read by a person yet, so it is not counted here
> either way.

That sentence is the one that did not exist in rehearsal 01, where "Risk:
none" would have been indistinguishable from a clean bill.

**One thing the presence score did that is worth stating:** confirming the
board record moved it from 61 to **57**. Attributing a `negative`
classification to the customer lowers the number. It is the right
direction and it is a slightly odd outcome of a correctness fix, and it is
recorded here rather than smoothed over.

### 3 — the review screen

Nothing preselected (`anyRadioChecked: false`), the button reads **"Choose
a decision"** and is disabled until one is made. Uphold is last, and says
what it does: "You have read the source and it establishes this. The
customer will be told it is settled."

### 4 — review work

**The queue held one record, not three.** Healthgrades and Doximity left
when the customer answered; the board record stayed, because she claimed
it and claiming it is not a judgement about what the source says.

One decision, recorded with a written reason. Access log: 7 `listed`, 1
`decided:reject_not_harm`.

### 5 — the durable report, and a defect found in the running system

The route behaved:

| Who | Result |
|---|---|
| No session at all | `401`, and the page says to sign in |
| **A different signed-in account** | `404` — identical to a scan that does not exist |
| That account's own page | `scans: 0, reports: []` |
| The owner, in a fresh session after signing out and back in | The report, 57, identity 4 of 4 |

Then the methodology-change guard, checked by actually changing it:
`PRESENCE_METHODOLOGY_VERSION` bumped to `3.1.0-rehearsal`, the report
reopened, and the snapshot history gained a row reading
`methodology 3.0.0-provisional → 3.1.0-rehearsal`. The version was
reverted afterwards.

**The notice did not appear.** The mechanism worked, the page said
nothing.

The page was rendering what `reconcileAssessment` returned, which is what
*that request* recorded. React mounts effects twice in development, so the
second fetch found nothing to reconcile, correctly returned null, and
overwrote the notice before it could be read. In production it would have
survived exactly one page view — worse, because that view might not be the
customer's.

A fact about the report is not a fact about the request that noticed it.
The notice is now derived from the append-only snapshot history, so it
persists for as long as the reassessment is the newest one. Verified by
loading the page twice.

That is the one defect this rehearsal found, and it was in the work the
rehearsal was convened to check.

---

## What is still true from rehearsal 01

- **No mail provider.** The customer's code is on screen under an honest
  notice; the reviewer's came out of the `email_outbox` table with a shell
  command. Every staff sign-in is still an operator with database access.
- **The audit form still opens pre-filled with Jensen Adoni**, the demo
  attorney, for a signed-in physician (F7). Unfixed: it was not in the
  milestone, and it is the one screen where typing the wrong person's name
  is the failure the product exists to prevent.
- **"Answering moves this figure"** (F8) — unfixed, though less wrong
  than it was: confirming the board record did move identity from 3 of 4
  to 4 of 4 this time, because that record was `uncertain` rather than
  `probable`.
- **No backups. Single-process worker.** Both unchanged and both written
  down in `COUNSEL_TECHNICAL_APPENDIX.md`.

## Human review minutes per engagement

Rehearsal 01: three records queued, two of which did not need a human.
Rehearsal 02: **one record queued, and it was the one that needed
reading.**

That is the metric moving for the right reason — not a faster reviewer, a
queue that stopped asking settled questions. The reading itself is still
unmeasured and still dominant: the only reason the board record was
decided correctly is that somebody read the sentence rather than the
phrase the classifier cited.

## What this does not establish

The engine is more careful than it was. Nothing here is evidence that it
is right about a real person: every result is still fixture data, no live
provider is connected, and `docs/OPEN_QUESTIONS.md` OQ-29 lists what the
first rehearsal left open. A genuine disbarment now also waits for a human
— the same change that stopped a clean record being reported as
misconduct. That trade was taken deliberately and it is the owner's to
revisit, not engineering's.

---

## Addendum — two corrections after rehearsal 02

Both from the review of this document, both verified in the running app.

**The headline said the opposite of the sentence under it.** The risk card
showed **None found**, in success green, above the new paragraph
explaining that one result mentioned something adverse and had not been
read. The qualification was accurate and nobody reads the qualification.

Three situations were sharing two words, and now do not: *no confirmed
adverse findings* (the actual assessed result), *review pending* (we found
something and have not finished reading it), and *not assessed* (nothing
was attributable to you, which is not the same as finding nothing against
you). The headline is derived from the pending count and the level, so the
screen and the print output cannot disagree about which it is, and an
unsettled assessment is no longer rendered in the success colour.
Verified: the card reads **Review pending** at 30px in ink rather than
green, over "1 result contains a possible adverse reference. Its meaning
has not been verified, so no adverse finding has been established — and
none has been ruled out either."

An established finding still outranks a pending one. Burying a severe
level under "Review pending" would be the same mistake upside down.

**The audit form stopped describing a stranger.** F7 from rehearsal 01,
left unfixed through the milestone. It now arrives empty; the fixture
subjects are loaded by a button that names who it is about to fill in; the
scenario picker no longer overwrites a name somebody typed; and the
attestation carries the line **"You are about to audit Amara Okonkwo."**
next to the box being ticked, because confirming "this audit is about me"
over a form you have not re-read confirms nothing.

That closes every finding from rehearsal 01 except the ones that are
purchases rather than code: no mail provider, no backups, and a worker
that dies with the server.
