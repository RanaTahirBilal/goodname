# Website

The public site and the audit interface. Next.js 16, App Router, TypeScript.

```
npm run dev --workspace @rep/website     # http://localhost:4300
npm run build --workspace @rep/website
npm test --workspace @rep/website        # contrast assertions
```

## Styling

Plain CSS with custom properties in `app/globals.css`, no framework.

The brief allows "Tailwind CSS or another documented styling system". This is
the documented alternative, chosen for one reason: `src/tokens.test.ts` parses
`globals.css` and asserts contrast against the literal token values, so the
stylesheet is the single source of truth and the check cannot drift from it. A
utility framework would put the real colours in class names scattered across
components, where nothing can verify them.

### There is no glass, and that is the decision

An earlier version used frosted panels on the landing hero and the score card.
They are gone, and a test now asserts no `backdrop-filter` or translucent
surface token comes back.

Three reasons, in order of weight:

**It reads wrong for the audience.** An attorney opens this worried, and may
be looking at a regulatory finding. A decorative frosted panel behind that
says the product does not take it seriously.

**It cannot be verified.** Over a light background, glass has to reach roughly
70% opacity before body text clears 4.5:1 — at which point it is a grey card
with a blur tax. Below that, text sits on a colour no stylesheet states.

**It dates the work.** Glassmorphism sits alongside gradient backgrounds and
shadows-on-everything in the list of things that read as a template.

Depth comes from typography, a spacing scale and hierarchy instead: one large
figure per view, a meter rather than a dial, rules and whitespace rather than
a card around every block.

### Status is never carried by colour alone

Every pill, notice and finding states its status in words — "Allegation — not
established", "Retracted by the source". The colour is reinforcement.

## Routes

| Route | What it is |
|---|---|
| `/` | Landing page. Static. |
| `/audit` | The audit flow: request → progress → report. Client-rendered. |
| `/api/audit` | Runs the audit. Dynamic. |

Both pages set `robots: noindex` — nothing here should be indexed while the
product is provisional, and customer reports must never be.

## Honesty in the interface

Three things the UI does deliberately:

**The fixture banner is unmissable.** No live provider is connected, so every
report opens with a warning that the data is fixture data. The flag comes from
the evidence records themselves, not from a page-level variable.

**The progress view shows only what is known.** The provider and the queries
are known before the request goes out, so those are shown. How far through
classification the server is, is not — so there is no staged progress bar. A
fabricated five-step animation would be the first thing in the product that
lied to the customer.

**A failed search shows no report.** An empty report would suggest we looked
and found nothing, which is a very different claim from not having looked.

## Not built

- Persistence. Reports exist only in the browser tab that requested them.
- Accounts, so the "Is this you?" buttons are inert and say so.
- Background jobs — the audit runs inside the request. Fine for a fixture,
  not for a live provider. See `docs/OPEN_QUESTIONS.md` OQ-11.
- A durable rate-limit store. The in-memory one resets on deploy.
