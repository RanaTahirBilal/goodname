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
