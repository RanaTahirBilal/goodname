# What to show, and what to say about it

A ten-minute walkthrough, in the order that makes the argument. Written
11 November 2026.

**The link:** https://ranatahirbilal.github.io/goodname/

That is a static snapshot of the landing page, taken from the real build.
It says so in a banner at the top, because a static copy of an application
is exactly the kind of thing that gets mistaken for the application. The
buttons do nothing: the audit itself needs a server, a database and a
search key.

**If you can run it live** (one command, see the last section), show that
instead. The snapshot is for sending a link to somebody who will not
install anything.

---

## The one sentence

> It runs the searches a person would, reads what comes back, and tells a
> professional what is findable about them, with every claim traceable to
> the result it came from and a refusal to score when the evidence is too
> thin.

What makes it different is not the score. It is what it refuses to do.

---

## The five minutes that make the case

### 1. The landing page, and the number on it

The example card says **50**, with coverage of 86% and a source-authority
dimension of **0**.

Those are not chosen numbers. The page runs the real scoring engine at
build time and prints what comes back. It used to show 71 and 88% and a
dimension of 43, all invented by whoever built the card, and no combination
of them was one the engine produces for any subject.

Worth saying out loud, because it is the whole posture: the marketing page
was made to stop flattering the product.

### 2. "What it takes to call something a finding"

Scroll to the claim ladder. Three tiers, and the conditions for moving
between them.

Most negative material stops at **Allegation** for ever. Promotion to an
established finding needs an official record that a person has read and
upheld in writing, or two genuinely independent sources, where syndicated
reprints of one story count as one source.

**This is the product.** Everything else is plumbing around this
distinction.

### 3. "What we keep afterwards"

A bar chart, drawn to scale. The short bar is the quotations about a
person: 180 days, then deleted. The long bar is a number, a coverage
fraction and a version string, kept.

The question any professional asks before typing their name into anything
is what you will be holding about them afterwards. The answer is a shape,
and the shape is the argument.

### 4. The report itself (live run only)

Run an audit on the `physician_review_complaint` scenario, confirm the
identity questions, and look at the risk card. It says **Review pending**,
not "none found", because one result mentions something adverse that
nobody has read yet.

That sentence is the most expensive thing in the product. It exists
because the first fulfillment rehearsal found the classifier reading

> "Certification is current. **No disciplinary actions are recorded**
> against this certificate."

as a severity-3 disciplinary finding on a doctor. It had matched the phrase
inside the sentence denying it.

### 5. The review queue (live run only)

`/review`, after `npm run staff -- add you@example.com reviewer`.

Nothing is preselected. The button says "Choose a decision" until one is
made. **Uphold is last**, because upholding is the act that creates a
finding about a person, which makes it the most deliberate thing on the
page rather than the default one.

It used to be first, and already selected.

---

## The questions you will be asked

**"Does it work?"**
The engine works and is tested, 427 tests, two end-to-end rehearsals with
every finding closed. It has never searched for a real person, because no
search key has ever been configured. That is now one environment variable
away: the provider is written, tested and wired in, and Google's free tier
is 100 queries a day with no card.

**"When can we sell it?"**
Not until a lawyer has read one narrow scope, and that cannot start until
somebody picks a state, a profession and an offer. There are ten gates
between here and taking money from a US customer and **one of them is
engineering**. `docs/DECISION_MEMO.md` has the four decisions, due
19 November.

**"How much did the AI write?"**
All of it, under review, with the reasoning for every non-obvious decision
in the commit messages and the source comments. Those are worth opening if
anybody wants to check the thinking rather than the output.

**"What is the risk?"**
That we tell somebody they have a disciplinary record when they do not.
The product is built around making that hard: a classifier that cannot
confirm anything on its own, a human who must write down why, a report that
distinguishes "we found nothing" from "we have not finished looking", and
two rehearsals whose entire purpose was to find the cases where it fails.
They found nine. All nine are closed.

**"What does it cost to run?"**
Search is the only per-audit cost and it is negligible: roughly $0.002 an
audit on the cheapest provider, against a four-figure engagement. The real
cost is human review minutes, which is unmeasured until a real engagement
and is the first metric to instrument.

---

## What not to claim

Say these plainly if they come up, because every one of them will be found
out in the first ten minutes of real use.

- **No audit has ever run against a real person.** Every report so far
  describes an invented one.
- **There is no iOS app and no admin dashboard.** The Android app is a
  paused project for a different audience and is not in this repository.
- **No hosting, no email, no payments, no backups.** The database is one
  file on one machine.
- **No legal review has happened.** The letter to counsel is written and
  unsent.
- **Nothing may be quoted as a price** until that decision is made.

---

## Running it live

```
npm install
npm run dev
```

Then open http://localhost:4300. Everything runs against fixture data and
says so on every screen.

For a real search, copy `.env.example` to `.env.local`, follow the two
links in it to get a free Google Programmable Search key and engine id,
and restart. With both set, every audit is real and the fixture banner
stops appearing. With neither, every audit is a fixture. There is no
in-between state, deliberately.

For the review queue:

```
npm run staff --workspace @rep/website -- add you@example.com reviewer
```

Sign-in codes are printed on screen, because no mail provider is
configured and pretending to send an email would be the kind of thing this
product is supposed to be the opposite of.
