# Request for a limited-scope US launch review

**Status:** draft, not sent. Bracketed items are for the business owner to
fill in before sending — nobody else knows them.

This document is written for a lawyer. It describes what the software
actually does, taken from the code rather than from a pitch, and asks the
questions we cannot answer ourselves. It contains no legal conclusions and
should not be read as containing any.

---

## 1. Who is asking

[Legal entity name, or "not yet formed"]
[State of formation / principal place of business]
[Contact name and email]

Working product name: GoodName. Nothing is launched, nothing is sold, and
no report has ever been produced about a real person.

## 2. What we want from this engagement

A fixed-fee, limited-scope review that answers: **may we lawfully sell and
deliver one narrowly defined service to one US customer, and what must we
change first.**

We are not asking for a review of a public automated platform. We expect
that to be a separate, later engagement, and we would like to know which of
our questions would need re-asking at that point.

Deliverable we are hoping for: a written list of launch blockers and
recommended controls, ordered by severity.

## 3. What the product does

A professional asks for an audit **of themselves**. The software runs
search queries for their name and professional details, then reports three
separate things:

- **Online Presence** — a 0–100 score for how established and findable
  their professional presence is, across five weighted dimensions.
- **Reputation Risk** — reported separately and deliberately never folded
  into the score, covering negative material found in the results.
- **Identity confidence** — how sure the system is that the results are
  about that person at all.

Each finding cites the search result it came from, with the source, the
date observed, and a verbatim excerpt. Excerpts are never paraphrased into
claims. The product makes no promise about rankings, removal of material,
or score improvement.

**No live search provider is connected.** Every audit to date has run on
fixture data describing invented people, flagged as such in the database
and on every screen.

## 4. The proposed first customer

We would like to start with the narrowest version we can:

- **One** US state: [state]
- **One** profession: [attorney / physician / other]
- A **named individual who has asked us** for an assessment of their own
  presence and has signed an authorisation.
- Delivered **manually**, with a human reviewing the assessment before the
  customer sees it.
- A fixed-scope engagement: an authorised baseline assessment, corrections
  to their own profiles and information, improvements to assets they own,
  and a completion report.

**Deliberately excluded from the first engagement**, and we would like
confirmation these exclusions are the right ones and are sufficient:

- No public self-service audit.
- No looking up anybody who has not asked us to.
- No report prepared for, or delivered to, anybody other than the subject.
- No employment screening, tenant screening, credit assessment, insurance
  eligibility, or any other eligibility use. These features do not exist in
  the software; the absence is deliberate.

## 5. What data the system holds, and for how long

We think the retention design is relevant to your analysis, so it is set
out in full.

**Per search result we store:** the URL, the publisher name, the domain,
the position in results, the date observed, the publication date where
given, the page title, and a short verbatim excerpt. Also our own derived
fields: an identity-match confidence and status, a classification, a
source-reliability rating, and who authored the content where we know it.

**Special categories are not stored at all.** Where a result appears to
touch health, religious belief, political opinion, sexual orientation,
ethnicity, trade union membership or immigration status, the title and
excerpt are discarded **before the record is created**, so the text never
reaches the database, the report or a member of staff. The URL, source and
date are kept, so nothing is hidden from the person it concerns, and the
report says plainly that it was done. An official record — a court or
regulator document — is never withheld this way.

**Retention periods:**

| Data | Kept |
|---|---|
| Evidence excerpts and titles | 180 days from retrieval, then deleted |
| Scores, coverage figures, methodology versions | Indefinitely |
| Human reviewer decisions | 730 days |
| Reviewer access log | 730 days |
| Customer sessions | 30 days |
| Staff sessions | 12 hours |

A scan expires as a unit rather than ageing out row by row, so a report is
never rebuilt from whatever happened to survive.

**Deletion.** A customer can request deletion in the product. The account is
scheduled for destruction 30 days later, is cancellable during that window,
and is then hard-deleted — scans, evidence, decisions, snapshots, sessions
and the account row. **One exception:** the log of which member of staff
read which flagged record is anonymised rather than destroyed, on the
reasoning that accountability for a decision made about a person should
outlive the material the decision was made on. **We would like to know
whether that exception is defensible, and under which framings it is not.**

**Export.** A customer can download everything we hold as JSON at any time.

## 6. Controls already built

Stated so you can tell us which of these do any work and which are theatre.

- **Purpose is a required input.** Only self-audit is supported; any other
  stated purpose is refused before any search runs. The exact attestation
  wording shown to the customer is stored on the record, so the audit
  carries the words they agreed to rather than a boolean.
- **The refusal happens before the search.** A blocked request costs
  nothing and leaves no record of that name anywhere, including with us.
- **Variety is limited more tightly than volume.** The signal we treat as
  meaningful is how many *different* names one requester looks up, not how
  many audits they run. A requester may run 5 audits in a rolling 24 hours;
  within that, a *second different name* requires a verified email address,
  and a third is refused outright with no route through — the escalation
  step that would unblock it is deliberately not implemented.
- **A permitted-use statement travels with the artifact.** One sentence,
  rendered in the report, printed with it, and the first field
  of every data export: that the report is for the person it describes,
  must not be used for employment, credit, housing, tenancy, insurance or
  any other eligibility decision, and is not a background check, consumer
  report or screening product.
- **Human review is narrow.** A reviewer sees flagged records only — no
  account, no other evidence from the same scan — every read is logged
  against them individually, and a decision without a written reason is
  refused.
- **Audit events record actor, action and subject, never payloads**, so the
  same personal data does not end up in two places with two retention
  stories.

## 7. The questions

Ordered by what would change what we do next.

1. **Does the first-customer workflow in section 4 raise consumer-reporting
   or FCRA questions**, and if so what specifically must remain excluded for
   it not to? We would rather narrow the product than rely on a disclaimer.

2. **Which privacy obligations attach**, given the entity, the states
   involved, and the data and retention described in section 5? In
   particular: is the 180-day excerpt expiry, with scores surviving
   indefinitely, a defensible split? And is the anonymised reviewer access
   log an acceptable exception to a deletion request?

3. **What is required before we publish material about a verified
   customer** — approvals, substantiation, record-keeping, disclosure of our
   role? Some of the service involves writing and publishing professional
   material on the customer's behalf.

4. **What restricts our outreach and our lead sources?** We are considering
   contacting professionals who have previously paid for biographical or
   recognition placements, identified from public listings. We would like to
   know what the restrictions are on that collection, on retaining it, and
   on contacting the people in it.

5. **What do the customer's own professional advertising rules require of
   us?** If we prepare or publish material for an attorney or a physician,
   we assume their state bar or state board rules reach that material. We do
   not know what they require of the person preparing it.

6. **What changes if this becomes self-service?** We want to know now which
   of your answers are specific to a manually delivered, authorised,
   single-subject engagement, so we do not mistake one approval for the
   other.

7. **What should the service agreement say** about authorisation, scope,
   exclusions, deletion and retention commitments, and ownership of
   published assets and accounts after the engagement ends?

## 8. What we are not asking

We are not asking whether the business is a good idea, and we are not
asking for a review of the software's security or architecture. If
anything in section 5 or 6 looks to you like a security question rather
than a legal one, please say so and we will take it elsewhere.

---

**Attached:** `COUNSEL_TECHNICAL_APPENDIX.md`, which describes the
implementation behind sections 5 and 6 — every table and column, the access
model, what leaves the system, the known limits of identity matching and
provenance, and a data-flow diagram. It contains no legal conclusions.

**Also available on request:** a sample report produced from fixture data, the
written safeguards document, the list of unresolved product questions, and the
source code.
