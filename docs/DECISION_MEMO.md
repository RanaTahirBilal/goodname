# Four decisions, due 19 November 2026

**For:** the owner. **Written by:** engineering. **Drafted:** 10 November 2026.

Nothing in this memo is a recommendation about whether to launch. It is the
four questions that are blocking, what each one actually decides, and what
follows from each answer, so that answering takes an evening rather than a
fortnight.

**Why the date.** A go-to-market review on 5 November set three gates:
19 November for these four decisions, 5 December to have counsel engaged and
real customer activity, 5 February to stop and archive if there is still no
legal path, no funded offer and no evidence of demand. They are management
deadlines, not statutory ones. The first one is the only one that needs
anything from you right now.

**Where engineering is.** Everything on the engineering list is done. The
audit engine, the report, retention, deletion, the review queue, the
authorship model, two fulfillment rehearsals with every finding closed, 427
tests. The one remaining engineering question (OQ-30) waits on decision 1
below. There is no software reason to delay.

**What has not changed and should be said plainly.** No search provider is
connected, so no audit has ever run against a real person. No hosting, no
mail, no payments, no backups. Those are purchases, and three of the four
only become purchases once these decisions are made.

---

## Decision 1: who the first customer is

**Answer three things together, because they only mean anything together.**

| | Your answer |
|---|---|
| State | |
| Profession | |
| Exact scope of the engagement | |

**Why these three.** Every legal question downstream is a question about a
specific scope in a specific jurisdiction for a specific profession.
"Professionals in the US" is not a scope a lawyer can review; "an attorney
licensed in Illinois, a baseline assessment plus corrections to their own
profiles, no publishing" is.

**What the product already refuses, which narrows the scope for you.** There
is no feature for auditing anybody who has not asked, no report prepared for
a third party, and nothing for employment, tenant, credit or insurance use.
Those absences are built rather than promised. The scope you write should
stay inside them.

**On profession.** The fixtures cover attorney, physician and founder. The
first two have state bar and state board advertising rules that reach
material prepared on their behalf, and those are per-state. A founder or
executive has no such regulator. That is a genuine difference in how much
counsel has to read, and it is worth knowing before choosing, not after.

**What this unblocks.** Decision 2 cannot be scoped without it, and neither
can the letter to counsel, whose section 4 has two blanks waiting on exactly
this: `[state]` and `[attorney / physician / other]`.

**One thing it settles for engineering.** OQ-30 asks which unresolved adverse
records should make a report read as pending, and the answer needs a
licensing jurisdiction we do not currently collect. If the first customer is
a licensed professional, collecting their state and board at intake becomes
obvious and the question closes. If they are a founder, it stays open and we
carry on reporting the count without promoting it.

---

## Decision 2: whether to authorise the legal review, and for how much

| | Your answer |
|---|---|
| Authorise a limited-scope US review | yes / no |
| Budget approved | |
| Who is instructing (entity, or "not yet formed") | |

**What is being bought.** A fixed-fee review of one narrowly defined service
for one customer, answering whether it can lawfully be sold and delivered and
what must change first. The letter is written and ready to send; it has five
bracketed fields, all of which are facts only you have.

**What it is not.** Not a review of a public automated platform. That is a
separate and later engagement, and the letter's sixth question asks counsel
to say which of their answers are specific to a manually delivered,
authorised, single-subject engagement, so one approval is not mistaken for
the other.

The three blanks in section 1 are yours too: legal entity name or "not yet
formed", state of formation, and a contact.

**What counsel is being asked.** Seven questions, the first being whether the
first-customer workflow raises consumer-reporting questions and what must
stay excluded for it not to. The technical appendix describing the
implementation is written: every table, the access model, retention and
deletion, what leaves via print and export, and the known limits, including
the one retention gap we found and closed ourselves.

**If the answer is no.** Then nothing is sold, which is the current state and
is sustainable indefinitely. The site stays `noindex`, no report is prepared
about anybody who has not asked, and the 5 December gate becomes the date
this is classified on hold rather than launching.

---

## Decision 3: manual-first, or automated-audit-first

| | Your answer |
|---|---|
| The first engagement is delivered | manually / by the platform |

**The default recommended by the go-to-market review was manual-first**, and
engineering agrees for a reason worth stating. The two fulfillment rehearsals
found nine defects between them. Two were wrong answers about a physician's
professional record: a clean board certification classified as a severity-3
disciplinary finding on a misread negation, and the board record that would
have cleared her rejected as somebody else because registries write surnames
first. One was that a finished report could not be opened twice. Every one
was found by running the thing rather than by reading it, including one in
the fix for another.

They are all closed. What that proves is that the rehearsal works, not that
the next nine do not exist.

**What manual-first actually means here.** The engine still does the
searching and the scoring; a person reads every adverse record before it
reaches the customer, which is already how the review queue works. The
difference is whether the customer ever touches the automated flow
themselves.

**What it costs.** Review minutes, which is the metric to watch from the
first engagement. Rehearsal 02 measured one record queued where the first had
three, after a change that stopped the queue asking questions the customer
had already answered. The reading itself is still unmeasured, and will be
until somebody reads a real source.

**What automated-first would need first.** A connected search provider, and
an answer to OQ-30, and the acceptance that a genuine disbarment currently
waits for a human before it raises a risk level, which is the price of
stopping a clean board record being reported as misconduct.

---

## Decision 4: testing whether anybody will pay

| | Your answer |
|---|---|
| How you will test it | |
| By when | |

**No price exists, and none should be quoted until this is answered.**
`OQ-23` holds two decisions that matter more than the number:

- **Not per asset.** Charging per published item creates a reason to publish
  things that add nothing, which is how this category earned its reputation.
- **Not a recurring automated scan.** A retainer has to carry enough review
  and accountability to be worth renewing, or it is a subscription to a cron
  job.

**The margin arithmetic is guesswork** until three engagements have been
delivered and timed, including revisions, approval delays and support. Any
number chosen now is a test price to find out what somebody will buy, not a
rate card.

**What engineering can say about cost.** Nothing useful yet. The only timed
delivery is 5m 18s by somebody who built the system and read no sources,
against fixture data, which is a floor and not an estimate.

---

## What follows, once these four are answered

In order, and most of it is not engineering.

| | Gate | Needs |
|---|---|---|
| 1 | Entity, registration, who legally sells | Decision 1 and 2, then counsel |
| 2 | The legal review itself | Decision 2 |
| 3 | Service agreement, disclosures, refund terms | Counsel |
| 4 | A lawful outreach process | Decision and counsel |
| 5 | Price, deposit terms, acceptance criteria | Decision 4 |
| 6 | A payment method | Purchase |
| 7 | Authorisation, intake, retention for that scope | Decision 1, then a small build |
| 8 | Hosting, a database with backups, a mail provider | Purchases |
| 9 | The deliverables | Operations |

**The purchases, as a list, so none of them is a surprise later:** a search
provider, hosting, a managed database (the current one is a single SQLite
file with nothing copying it), a mail provider, and a payment method. Four of
the five only become decisions once the scope above exists.

---

## What engineering will do while this is open

Nothing that adds product surface. The standing instruction after the last
milestone was to stop and wait for an authorised next step, and that is the
right instruction.

If these decisions slip past 19 November, the agreed behaviour is to escalate
once with the precise unresolved items and not to generate replacement work.
This memo is that escalation, sent early.
