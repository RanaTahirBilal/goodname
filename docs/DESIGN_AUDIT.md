# Design audit: what exists across the four platforms

Written 5 November 2026 against the repository at `14945b5`, before any
visual work. The brief names four platforms. Three of them do not exist,
and saying so first is cheaper than discovering it halfway through.

---

## 1. What is actually here

| Platform in the brief | What exists | Where |
|---|---|---|
| **Public website** | 6 pages, a 1,099-line stylesheet, 37 design tokens, ~60 component classes, light and dark themes, measured contrast | `apps/website` |
| **Backend / admin dashboard** | **Nothing.** No admin exists | `CLAUDE.md`: "Not yet built: admin, billing…" |
| **Android application** | A paused Expo app for a different audience, **not in this repository** | `goodname-app/`, gitignored |
| **iOS application** | **Nothing.** No iOS project has ever been generated | no `goodname-app/ios` |

### The website, in detail

| Page | Purpose |
|---|---|
| `/` | Marketing page: hero, three-step explanation, scope limits |
| `/audit` | The intake form and the live report |
| `/report/[id]` | A saved report, reopenable (added this week) |
| `/account` | Report list, data export, account deletion |
| `/signin` | Passwordless sign-in |
| `/review` | The staff review queue, behind a separate session |

`/review` is the closest thing to an admin panel: one queue, one record at
a time, four decisions and a written rationale. It is deliberately narrow,
because it is the only screen in the product that reads across accounts.
Turning it into a dashboard with sidebars, widgets and analytics would
widen the one surface whose narrowness is a safeguard (rule 16o).

### The mobile app

`goodname-app` has 35 routes, its own themed design system and a contrast
test. It is **gitignored** (`.gitignore` line 50), so it is not under
version control here. It was built for a consumer or small-business
audience managing reviews, locations and broker removals. `PD-005` paused
it: the current audience is attorneys, physicians and founders, and the
revenue path is audit to report to managed workflow, on the web.

It has an `android/` directory from an Expo prebuild. It has no `ios/`
directory, so there is no iOS app to redesign; there is an iOS app that
could be generated from the Expo project, which is a different statement.

---

## 2. The existing design system

Not absent, and not informal. `apps/website/app/globals.css` already has:

- **37 semantic tokens** for colour, with full redefinitions for dark mode
  and a third set for print.
- **A spacing scale** (`--s-1` through `--s-24`), asserted by a test that
  fails if a gap is written outside it.
- **Two typefaces**, a serif for editorial text and a sans for interface.
- **~60 component classes**: cards, pills, notices, meters, tables, forms,
  the evidence register, the cover.
- **A print stylesheet** that un-reverses the cover, forces the evidence
  register visible and holds collapsed sections open.

And it is tested. `tokens.test.ts` measures contrast rather than eyeballing
it: body text clears 4.5:1 on every surface it is used on, control outlines
clear 3:1, and both dark declarations are asserted to carry identical
values.

**Weaknesses, honestly.** There is no icon system at all. There are no
images anywhere: no photography, no illustration, no diagrams, no empty-state
art. The marketing page carries its argument entirely in type. Loading
states are text. There is no motion of any kind, so there is also nothing
to make respect `prefers-reduced-motion`.

---

## 3. The conflict worth naming before any of it is built

The brief asks for frosted glass and translucency. The product's credibility
rests on a report about a named person being legible and measurable.

This is not a blocker, and I want to be precise about why. `tokens.test.ts`
already carries an `over()` function that composites a translucent colour
over an opaque one, kept deliberately against the day a tinted surface
returns. So a glass surface can ship here on one condition: its **effective**
contrast, composited over its worst-case backdrop, is measured and passes,
rather than its nominal contrast being quoted against a background it never
actually sits on.

Three places where I would expect to refuse glass, and say so now rather
than after building it:

1. **The evidence register when printed.** Browsers do not print background
   colours. A translucent panel prints as nothing, and the register is the
   part of the report that makes a score accountable.
2. **The risk card.** It currently distinguishes "no confirmed adverse
   findings" from "review pending" partly by ink colour. Translucency over
   a varying backdrop makes that distinction unreliable.
3. **The review queue.** Data-heavy, read under time pressure, and the one
   screen where a misread leads to a false allegation about somebody.

The brief says the same thing in its own words: glassmorphism should enhance
usability rather than reduce readability, and functionality comes before
decoration on data-heavy screens. I am flagging where I read those two
instructions as being in tension with "apply across the entire ecosystem",
and proposing the test as the arbiter.

---

## 4. Priorities, if the work proceeds

Ordered by what a real customer would notice.

1. **An icon system.** The largest single gap. There are no icons, so every
   status, action and affordance is carried by text alone.
2. **Imagery with a job.** Diagrams of what the audit does, an empty state
   for the account page, a visual of the evidence chain. Not stock
   photography of people at whiteboards.
3. **Motion**, with `prefers-reduced-motion` honoured from the first line.
4. **Glass surfaces**, applied where the backdrop is controlled and the
   composited contrast is measured. Cover, hero, navigation.
5. **The marketing page**, which is the only page a stranger ever sees and
   is currently all type.

Explicitly not on this list: a dashboard rebuild of `/review`, and anything
in `goodname-app` while PD-005 stands.

---

## 5. The dash rule

Done, and enforced. See `apps/website/src/copy.test.ts`.

Every em dash and en dash has been removed from interface text across the
website, the engine packages and the outbound email bodies: 50 occurrences
across 19 files, replaced with commas, colons, full stops, parentheses or a
rewritten sentence. Three were placeholder glyphs in figure cells and became
words: `None`, `n/a`, `Not scored`.

**One carve-out, which is not a loophole.** A search result's title and
excerpt are quoted third-party content, reproduced verbatim and never
paraphrased. Real pages are full of em dashes: "Okonkwo, Amara — Board
certified" is how a medical board actually writes it, and that exact string
is what the surname-first identity fix was built against. Editing a
quotation to satisfy a typography rule is falsifying evidence. It is a small
falsification, which is exactly why it is worth refusing.

The carve-out is held to the two fields that carry quotations, asserted by a
second test, so it cannot widen into "the fixture file is exempt". Comments,
`docs/`, commit messages and test names are not interface text and are not
covered.

A third test plants a dash and asserts the detector catches it, because a
lint that silently matches nothing passes for ever.

---

# Implementation record

The audit above was written before any work. This is what was built against
it, in four commits, and what each one caught. Written after the fact so the
list of priorities and the account of what happened to them are not the same
paragraph edited twice.

## What shipped

| Priority | Status |
|---|---|
| 1. An icon system | Done. 12 glyphs, one family, used at 13 call sites |
| 2. Imagery with a job | Partly. Evidence chain, two empty states. No photography, no further diagrams |
| 3. Motion | Done. Two durations, one curve, one reduced-motion switch |
| 4. Glass surfaces | Done, on two surfaces, with contrast composited and measured |
| 5. The marketing page | Done |

The stylesheet went from 1,099 lines and 37 tokens to 1,404 and 44. The
website's own test count went from 35 to 63.

## The four things the work caught that reading would not have

Each of these passed every check that existed before it was looked at
directly. They are the argument for verifying in the browser rather than at
the end of a build log.

**The glass had no blur for an hour, and nothing looked wrong.** The
stylesheet declared `backdrop-filter` followed by a hand-written
`-webkit-backdrop-filter`. Lightning CSS, which Next runs over this file,
resolved that pair against its browser targets and dropped the property
entirely. The served rule had no blur in it at all. It was invisible because
the fallback is deliberately good: at 92% opacity the surface is the right
colour and the right contrast with or without a blur. Only reading the
computed style found it. There is a test now.

**The glass failed an accessibility floor at the opacity that looked best.**
At 82%, the muted text colour composited over the darkest ground in the
product came to 4.10:1. The test said so before any of it shipped, which is
the entire reason the measurement exists: a frosted surface fails a floor
while looking correct in every screenshot. 92% is the number that passes,
not the number that was chosen.

**A hard-coded duration that reduced motion could never have switched off.**
`transition: transform 120ms ease` on the disclosure chevron, written long
before the motion tokens existed. Zeroing the tokens cannot reach a number
that never asked for one. Found by a test asserting every duration reads a
token, not by looking at the chevron.

**A 4px optical misalignment, measured rather than nudged.** The notice glyph
aligned to the top of its flex row rather than to the first line of text
beside it: icon centre at 133px, first-line centre at 137px. Not enough to
name and enough to look careless where a title wraps. Both now land on the
same pixel.

## Decisions worth keeping

**The header is glass at 92%, not 10%.** The previous comment in `layout.tsx`
argued against a frosted header because a blurred bar over an evidence table
leaves the row beneath half-legible while somebody is reading it. That is
true of a low-opacity wash and false at 92%, where the row is behind
something rather than showing through it. The blur supplies depth, the
opacity supplies contrast, and the worst-case and best-case backdrops produce
nearly the same colour, which is asserted with its own test.

**Glass is refused in two places**, enforced rather than remembered: the
evidence register, which has to print and which browsers will not print
backgrounds for, and anything a reviewer reads closely. A test fails if a
backdrop filter is ever added to either.

**The running audit has an indeterminate bar that will not fill.** A
percentage would be invented: the job reports no stage, so a filled
proportion is a guess rendered as a fact. A travelling segment claims only
that work is happening. Under reduced motion it becomes a full-width muted
track rather than freezing mid-travel, which would have read as a progress
bar stuck at 35%, precisely the false claim the bar exists to avoid.

**Icons are drawn here rather than installed.** An icon library is a supply
chain, a bundle and a licence in exchange for 1,400 glyphs of which twelve
are used. They are stroked SVG on `currentColor` sized in `em`, so an icon
beside text is the colour and size of that text and inherits its contrast
result, and so they print as line art with the words around them.

**An icon is decoration or meaning, never both.** Without a `label` the SVG
is `aria-hidden`; with one it is an image with a name. An icon repeating the
word beside it makes a screen reader say the word twice, so the component
makes the wrong choice hard rather than documenting the right one.

**Notices come from one component.** Twelve hand-assembled divs carried their
tone in colour alone wherever somebody had not remembered a glyph. The tone
now reaches a reader three ways: colour, the word in the title, the shape.

## What is still missing

Honest list, in the same order as the priorities above.

- **No photography and no illustration.** The evidence chain is the only
  diagram. A product explaining what it does to a sceptical professional
  could use two or three more, and none of them should be stock.
- **No product screenshots.** The marketing page shows a hand-built example
  card rather than the real report, which is safer (it cannot drift out of
  date silently) and less convincing.
- **No icons on the audit form.** Deliberate: an icon beside a field label is
  decoration repeating the label, which is the rule the set is held to.
- **`/review` is unchanged as an information architecture.** One record at a
  time, four decisions, a written reason. It got an empty state and two
  glyphs and nothing else, because its narrowness is the safeguard rather
  than a gap: it is the only screen in the product that reads across
  accounts.
- **Nothing on the other three platforms**, which still do not exist.
