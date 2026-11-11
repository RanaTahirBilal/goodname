# Reputation Platform

An audit of a professional's own online presence: what ranks for their name,
what each result is based on, and how confident we are it is even them.

Internal name only. Nothing here is branded or launched.

**Build status:** <https://ranatahirbilal.github.io/goodname/> — what is verified,
what is fixture data, and the one defect that would break a live demonstration.
Corrections belong in [an issue](https://github.com/RanaTahirBilal/goodname/issues/new).

---

## Run it

```bash
npm start
```

Installs if needed, builds, and serves on <http://localhost:4300>. Needs
Node 26 or newer, which it checks for and explains rather than failing
strangely: the engine ships TypeScript and relies on type stripping to run,
which is what lets it work with no build step.

Without Node 26:

```bash
docker compose up
```

Same thing, on port 4300, with the database in a named volume.

**It is healthy when `/api/health` says so.** That endpoint asks the two
questions a port check cannot: does the database answer, and is the
background worker running. A process whose worker is dead serves every page
normally and finishes no audits.

For the staff review queue:

```bash
npm run staff -- add you@example.com reviewer
```

Other things:

```bash
npm test                     # every workspace
npm run typecheck
npm run dev                  # with hot reload, same port
cd packages/domain && node src/demo.ts official_finding
```

### Making it search for real

Every audit uses fixture data until two variables are set, and says so on
every screen. Copy `.env.example` to `.env.local`, follow the two links in
it for a free Google Programmable Search key and engine id (100 queries a
day, no card), and restart.

Both variables or neither. There is no half-configured state, and the scan
row records which one produced it, so a report can never be labelled fixture
while holding live results or the other way round.

---

## What is where

| Path | What it is |
|---|---|
| `packages/domain` | The audit engine. Pure functions, no I/O. |
| `packages/persistence` | SQLite storage, auth, review, retention, deletion. |
| `apps/website` | The site, the audit flow and the report. |
| `docs/` | Scoring spec, evidence model, safeguards, open questions. |
| `docs/SHOW_AND_TELL.md` | Ten-minute walkthrough for showing this to somebody. |
| `docs/DECISION_MEMO.md` | The four decisions blocking a first customer. |
| `CLAUDE.md` | Operating rules. Read before changing anything. |
| `goodname-app/` | An earlier Expo app for a different audience. **Paused**, and not wired to this engine. |

---

## The three outputs

An audit does not produce one number. It produces three things, kept apart on
purpose:

**A — Online Presence Score.** 0–100, how well established the presence is.
Contains no risk dimension.

**B — Reputation Risk.** A level plus the findings behind it, with no
aggregate number at all. An allegation is never reported as a finding, and a
retracted story leaves the level while staying visible.

**C — Confidence.** How sure we are it is the right person, and how much of
the model we could evaluate — separately, because they have different fixes.

A person can have a strong presence *and* a severe problem. One number cannot
say both, which is why there are three. See `docs/SCORING_SPEC.md`.

---

## State

**Live search is implemented and waiting for a key** (see above). Until one
is set, everything runs against fixture data, no report describes a real
person, and every screen says so.

Not built: admin, billing, AI providers, a mail provider. Audits do run in
background jobs, and evidence ages out on a retention timer.
Blockers and unresolved decisions are in `docs/OPEN_QUESTIONS.md`; the ones
gating a public launch are in `docs/SAFEGUARDS.md`.

Scoring is provisional and has not been empirically validated. The product
measures observable online presence. It does not measure character, honesty
or competence, and promises no rankings, removals or score increases.

---

## Deploying it

Any host that runs a container and gives it a persistent volume: the
`Dockerfile` sets `REP_DB_PATH=/data/rep.db` and declares `/data` as a
volume, because a SQLite file written into the container filesystem is
deleted by the next deploy and the failure mode is every customer's audits
quietly disappearing. There are no backups of that volume. That is written
up as a gap in `docs/COUNSEL_TECHNICAL_APPENDIX.md`, not as a feature.

**Not GitHub Pages.** Pages serves static files, and this is a server with
API routes, session cookies, a background worker and a database. The page at
<https://ranatahirbilal.github.io/goodname/> is a static snapshot of the
landing page with a banner saying so; its buttons do nothing.

The SQL avoids anything SQLite-specific, so moving to Postgres is a driver
change rather than a rewrite. It has not been done.

## Licence

None. All rights reserved. Public so it can be read, not so it can be reused.
