# Demo run sheet

Five minutes, web app, fixture data. Everything below has been walked through
and works.

---

## Before they walk in

```bash
cd ~/Desktop/goodname
find apps/website/.data -name 'rep.db*' -delete   # fresh account, fresh limits
npm run build --workspace @rep/website
npm run start --workspace @rep/website
```

Open **http://localhost:4300**.

`npm run dev` also works, but a production build will not pause to compile a
route mid-demo.

Resetting the database matters: audits are rate-limited per account, and a
clean start means the limits behave predictably in front of an audience.

---

## The run

### 1. Landing — 30 seconds

Read the three lines under the hero. They are the product claim:

> Every finding links to its source and the date we saw it.
> Allegations are labelled as allegations, never as findings.
> We tell you when the evidence is too thin to score.

The sample report on the right is static and labelled **Example report**.

### 2. Check My Reputation → the form

Pre-filled with a demo identity. Point at the attestation checkbox — the
product only audits the person using it, and that is enforced, not promised.

Leave the scenario on **"Well-established presence, nothing negative"**.

### 3. The report — the main event

Three things to point at, in this order:

**Fixture banner.** Opens with "This report is built from fixture data." No
search provider is connected, and the report says so rather than implying the
results are real.

**Presence and risk, side by side.** This is the design argument. The score
is the largest thing on the page; the risk level sits beside it, set in
words. They are two separate statements, and a single number cannot say both.

(The exact score moves with what is in the form — do not quote a number from
this sheet, read whatever is on screen.)

**The evidence table.** Every row carries its source, the date we saw it, how
confident we are that it is the right person, and why it was classified the
way it was — including the rows we *excluded* and the reason.

### 4. Run it again with "An official disciplinary record"

Same name, so the safeguard does not fire.

Now the report shows a **Severe** risk level with an established finding —
and the presence score is still there, largely unchanged. That is the point:
someone can have a well-built professional presence *and* a serious problem,
and the report can say both at once.

Under the finding, show the status wording: **"Established finding"** versus
**"Allegation — not established"** in the other scenarios. Conflating those
two is how a reputation tool becomes a defamation engine.

### 5. "Is this you?" — the best moment in the demo

Still on the disciplinary report, scroll to **How confident we are**.

The one result awaiting confirmation *is the disbarment record* — we are only
62% sure it is the same Jensen Adoni. Click **Not me**.

Watch what changes:

| | Before | After |
|---|---|---|
| Online presence | 56 | 59 |
| Reputation risk | **Severe** | **None found** |
| Attributed results | 4 | 3 |
| Top recommendation | "Review an established finding" | gone |

A **How this score has changed** table appears showing both values and the
reason — `customer rejected ev-002`. Earlier scores are kept as written; a
recalculation adds a row rather than editing one.

This is the whole product in one click: we were not sure it was them, we said
so rather than assuming, and when they told us, everything downstream
rebuilt. Worth saying out loud — the alternative is a tool that confidently
attributes a disbarment to the wrong person.

### 6. The safeguard — if there is time

Run an audit with a **different** name. It is refused:

> **We stopped this one on purpose**
> Confirm your email address before auditing a different name.

Worth saying out loud: re-running your *own* name is never restricted. The
limit is on how many *different* names one account looks up, which is the
thing standing between this and a people-search engine.

### 7. The review queue — only if they ask who checks this

Not part of the five minutes. If someone asks what happens to a finding we
are unsure about, this is the answer.

```bash
npm run staff --workspace @rep/website -- add you@yourcompany.com reviewer
```

Open **http://localhost:4300/review**, enter that address, and read the code
out of the development outbox (no mail provider is configured):

```bash
curl -s "localhost:4300/api/auth/outbox?email=you@yourcompany.com"
```

The record waiting is the disbarment notice, flagged because we are only 62%
sure it is the same Jensen Adoni. Downgrading it to an allegation softens the
customer's report without hiding the result, and the decision is stored beside
the classifier's original call rather than replacing it.

Two things to say: the queue is off until somebody is deliberately added, and
there is no sign-up — verifying a code never creates a reviewer.

### 8. What we refuse to hold — the one for a privacy-minded room

Run an audit with **"Personal matters mixed in with professional ones"**.

Five results come back. Three of them render as *Withheld — see the source*,
and the report says so in a sentence above the table: these touch on health,
faith or politics, we do not store or repeat that material, and none of it
affects the score or the risk level.

The point to make is the one people do not expect: **we are not hiding it from
them.** Every withheld row keeps its link, and the material is public at its
source. We are declining to keep a copy. Nothing sensitive is in our database
at all — there are tests that search the raw SQLite file for those words.

Then point at the two results that were *not* withheld: the immigration
attorney's own practice page, and an oncologist's clinic listing. Both are
full of words a keyword filter would trip on. A privacy control that deleted
a whole profession's work would be worse than none.

### Printing it

The report has **Print or save as PDF**. Worth showing if anyone asks what
they walk away with: the navigation and buttons drop, the evidence table
stays a table, every link prints the URL it points at, and the fixture
warning prints in a black box at the top. That last one is deliberate — a
printed report leaves the room with no way for the reader to ask whether any
of it is real.

---

## Questions you will get

**"Is this real data?"**
No. No search provider is contracted yet. Every screen says so. Choosing one
is the next decision, and it sets the cost per audit.

**"How accurate is the score?"**
The methodology is provisional and labelled as such on every report. It has
not been empirically validated, and the product never claims otherwise.

**"Can it find anything about anyone?"**
No, by design. It audits the person using it.

**"When can we sell this?"**
Not yet. A search provider, a mail provider and legal review are all
outstanding — `docs/OPEN_QUESTIONS.md` has the list.

---

## Do not demo

- **The mobile app** (`goodname-app/`). It runs, but on its own older mock —
  it is not connected to this engine, and its scoring is a different model.
- **Sign-in**, unless asked. It works, but no mail provider is configured so
  the code appears on screen, which needs explaining mid-demo.

---

## If something goes wrong

**Audit refused unexpectedly** — the per-account limit is 5 audits a day and
2 distinct names. Stop the server, run `find apps/website/.data -name 'rep.db*' -delete`,
start again.

**Port 4300 in use** — this one is a trap. `next start` renames its process
to `next-server`, so `pkill -f "next start"` does **not** kill it. The new
server then fails to bind with `EADDRINUSE` and you keep seeing the old
build. Kill it by port:

```bash
lsof -ti:4300 | xargs kill -9
```

**A blank report** — pick a different scenario. "The search provider fails"
and "The search returns no results" deliberately produce no report; they
exist to show that a failed search is never dressed up as an empty one.
