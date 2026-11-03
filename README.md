# Reputation Platform

An audit of a professional's own online presence: what ranks for their name,
what each result is based on, and how confident we are it is even them.

Internal name only. Nothing here is branded or launched.

**Build status:** <https://ranatahirbilal.github.io/goodname/> — what is verified,
what is fixture data, and the one defect that would break a live demonstration.
Corrections belong in [an issue](https://github.com/RanaTahirBilal/goodname/issues/new).

---

## Run it

In VS Code: **Cmd + Shift + B**, then open <http://localhost:4300>.

Or from a terminal:

```bash
npm run build --workspace @rep/website
npm run start --workspace @rep/website
```

Other tasks live under **Cmd + Shift + P → Tasks: Run Task** — stop the app,
reset the demo database, run the tests, or print a report in the terminal
without a browser.

```bash
npm test                     # 268 tests
npm run typecheck
cd packages/domain && node src/demo.ts official_finding
```

---

## What is where

| Path | What it is |
|---|---|
| `packages/domain` | The audit engine. Pure functions, no I/O, 104 tests. |
| `packages/persistence` | SQLite storage, auth, review, retention, deletion. 143 tests. |
| `apps/website` | The site, the audit flow and the report. |
| `docs/` | Scoring spec, evidence model, safeguards, open questions. |
| `DEMO.md` | Five-minute run sheet for showing this to someone. |
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

Everything runs against **fixture data**. No search provider is contracted, so
no report describes a real person and every screen says so.

Not built: admin, billing, AI providers, a mail provider. Audits do run in
background jobs, and evidence ages out on a retention timer.
Blockers and unresolved decisions are in `docs/OPEN_QUESTIONS.md`; the ones
gating a public launch are in `docs/SAFEGUARDS.md`.

Scoring is provisional and has not been empirically validated. The product
measures observable online presence. It does not measure character, honesty
or competence, and promises no rankings, removals or score increases.

---

## It does not deploy to GitHub Pages

Pages serves static files. This is a Next.js server with API routes, session
cookies, a background worker and SQLite on local disk. A live URL needs a Node
host and a hosted database; moving off local-disk SQLite is a real piece of
work, not a configuration change. Written here so nobody tries.

## Licence

None. All rights reserved. Public so it can be read, not so it can be reused.
