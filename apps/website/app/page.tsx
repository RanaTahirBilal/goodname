/**
 * The landing page.
 *
 * No glass, no gradient wash, no blurred orbs. The hero earns attention from
 * one large headline and a single accent-coloured action; the preview beside
 * it is a flat card, because the thing worth showing is the report's clarity
 * rather than a surface treatment around it.
 *
 * Every gap here comes from the spacing scale. The page previously carried
 * inline 6s, 14s, 18s and 20s, which is how a layout drifts: each one looked
 * right on its own and none of them agreed with the others.
 *
 * The headline used to be "Understand what people find when they search for
 * you", which is true of a search-results preview tool as well as of this.
 * What separates this from one is below it, in the standfirst: the source,
 * the date, whether it is even about you, and a refusal to score when the
 * evidence is too thin. A headline promises the thing; the line under it
 * says why this one is different.
 */
import {
  DIMENSION_LABELS,
  FIXTURE_SUBJECTS,
  FixtureSearchProvider,
  SELF_AUDIT_ATTESTATION,
  riskHeadline,
  runAudit,
  type AuditPurpose,
  type ProfessionalIdentity,
} from '@rep/domain';
import { Icon, type IconName } from './components/Icon';
import { ClaimLadder } from './components/ClaimLadder';
import { RetentionTimeline } from './components/RetentionTimeline';

/**
 * The hero preview, computed by the engine rather than written by hand.
 *
 * It used to be a static card claiming a score of 71, 88% coverage and
 * three dimension values, over a risk level of Elevated. Every one of those
 * numbers was invented by whoever built the card, and no combination of
 * them is one the engine would ever produce. That is a small dishonesty on
 * the one page whose argument is that this product does not round things
 * up, and it is also a maintenance trap: change the scoring and the
 * marketing page goes on quoting a report that no longer exists.
 *
 * So the landing page runs a real audit. The provider is the fixture, the
 * subject is invented, the engine is the same one a customer's report comes
 * out of, and `hero.test.ts` fails if the page ever shows a figure the
 * engine does not produce.
 *
 * It costs nothing at runtime: the domain package does no I/O, this is a
 * server component, and the page stays static.
 *
 * The `allegation` scenario, specifically. A clean report is a worse
 * illustration of what this product is for than one with something
 * unsettled in it, correctly labelled as unsettled, which is the whole
 * distinction the claim ladder further down the page describes.
 */
async function example() {
  const s = FIXTURE_SUBJECTS.adoni;

  const identity: ProfessionalIdentity = {
    fullName: s.fullName,
    profession: s.profession as ProfessionalIdentity['profession'],
    employer: s.employer,
    city: s.city,
    region: s.region,
    credentials: s.credentials.split(', ').filter(Boolean),
    websiteUrl: s.websiteUrl,
  };

  const purpose: AuditPurpose = {
    kind: 'self_audit',
    attestationText: SELF_AUDIT_ATTESTATION,
    attestedAt: '2026-10-29T00:00:00.000Z',
    verification: 'verified_email',
  };

  const report = await runAudit({
    identity,
    purpose,
    provider: new FixtureSearchProvider('allegation'),
  });

  if (report.status !== 'complete' || report.presence.status !== 'scored') {
    // The fixture is deterministic, so this cannot happen without somebody
    // having changed the scenario. Failing the build is the right answer:
    // the alternative is a hero with a hole in it.
    throw new Error(`the landing page example did not produce a report: ${report.status}`);
  }

  return report;
}

export default async function Home() {
  const report = await example();

  return (
    <>
      <section style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="wrap" style={{ padding: 'var(--s-24) var(--s-6) var(--s-16)' }}>
          <div
            className="cols cols-score"
            style={{ alignItems: 'center', gap: 'var(--s-16)' }}
          >
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
              <p className="eyebrow mark">
                For attorneys, physicians, founders and executives
              </p>

              <h1 style={{ maxWidth: '15ch' }}>
                See what they find when they search your name.
              </h1>

              <p className="lede">
                Every result, with its source, its date, and how sure we are it is even
                about you. When the evidence is too thin to judge, we say so instead of
                scoring it anyway.
              </p>

              <div className="row" style={{ gap: 'var(--s-4)', flexWrap: 'wrap' }}>
                <a href="/audit" className="btn btn-primary">
                  Check My Reputation
                </a>
                <span className="small">Free. No card. Self-audit only.</span>
              </div>

              <ul
                className="small stack"
                style={{
                  listStyle: 'none',
                  ['--gap' as string]: 'var(--s-2)',
                  paddingTop: 'var(--s-2)',
                }}
              >
                {([
                  ['source', 'Every finding links to its source and the date we saw it.'],
                  ['alert', 'Allegations are labelled as allegations, never as findings.'],
                  ['eye', 'We tell you when the evidence is too thin to score.'],
                ] as [IconName, string][]).map(([icon, line]) => (
                  <li
                    key={line}
                    className="row"
                    style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}
                  >
                    {/*
                      A tick three times said only "this is a list". These
                      say what kind of promise each line is: a citation, a
                      distinction, a refusal.
                    */}
                    <span style={{ color: 'var(--primary)', lineHeight: 1.55 }}>
                      <Icon name={icon} />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <HeroPreview report={report} />
          </div>
        </div>
      </section>

      <Steps />

      <EvidenceChain />

      <ClaimLadder />

      <RetentionTimeline />

      <section className="wrap" style={{ paddingTop: 'var(--s-16)' }}>
        <div className="cols cols-2" style={{ gap: 'var(--s-12)' }}>
          <article className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
            <h2 className="mark" style={{ fontSize: '1.5rem' }}>
              What we will tell you
            </h2>
            <p className="small" style={{ fontSize: '0.9375rem' }}>
              How established your presence is, what negative material exists and how settled
              it is, how sure we are that any of it is you, and what is worth doing next.
              Each point carries the evidence behind it.
            </p>
          </article>

          <article className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
            <h2 className="mark" style={{ fontSize: '1.5rem' }}>
              What we will not
            </h2>
            <p className="small" style={{ fontSize: '0.9375rem' }}>
              We do not promise rankings, removals or a higher score. We do not treat
              criticism as damage. We do not look up other people. This is a self-audit, and
              it is limited to that on purpose.
            </p>
          </article>
        </div>
      </section>

      <Closing />
    </>
  );
}

/**
 * Three steps, because the objection this page has to answer is "what
 * actually happens if I type my name in".
 *
 * Numbered in the serif at display size so the sequence is legible before
 * any of the words are, and separated by whitespace rather than by three
 * more cards — a row of boxes would make these look like features to
 * compare instead of an order to read.
 */
function Steps() {
  const steps: { n: string; icon: IconName; title: string; body: string }[] = [
    {
      n: '01',
      icon: 'identity',
      title: 'Tell us who you are',
      body:
        'Name, profession, and whatever else distinguishes you: employer, city, credentials, your own site. Every detail is one more way to tell you apart from someone who shares your name.',
    },
    {
      n: '02',
      icon: 'search',
      title: 'We search and read the results',
      body:
        'We run the searches a person would, then work through what comes back: what each result is, who published it, whether it is settled or merely alleged, and whether it is about you at all.',
    },
    {
      n: '03',
      icon: 'document',
      title: 'You get the evidence, not just a number',
      body:
        'A presence score, a separate read on negative material, and how confident we are in the identity match. Each one is traceable to the results it came from, which are listed in full.',
    },
  ];

  return (
    <section className="wrap" style={{ paddingTop: 'var(--s-16)' }}>
      <h2 className="mark" style={{ fontSize: '1.5rem', marginBottom: 'var(--s-8)' }}>
        What happens when you run one
      </h2>

      <ol className="steps">
        {steps.map((s) => (
          <li key={s.n} className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
            <span
              className="row"
              style={{ gap: 'var(--s-3)', alignItems: 'baseline', color: 'var(--primary)' }}
            >
              <span className="step-number" aria-hidden>
                {s.n}
              </span>
              <Icon name={s.icon} scale={1.15} />
            </span>
            <h3>{s.title}</h3>
            <p className="small" style={{ fontSize: '0.9375rem' }}>
              {s.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * What happens to one search result.
 *
 * The argument this page makes is that a number is worthless without the
 * chain behind it, and until now that argument was three paragraphs of
 * type. A chain is a shape, so it should be drawn: four stops, two of which
 * are exits, and the exits are the point. A result can leave the chain by
 * not being you, and it can leave by being adverse but unestablished.
 *
 * Inline SVG rather than an image file. It takes its colours from
 * `currentColor` and the CSS variables, so it is correct in both themes and
 * when printed without anybody maintaining three copies. It carries a
 * `<title>` and a `<desc>`, and the same sequence is written out in text
 * below for anyone who cannot see it, because a diagram that is the only
 * statement of something is not accessible by being tagged.
 */
function EvidenceChain() {
  const stops: { icon: IconName; label: string; note: string }[] = [
    { icon: 'search', label: 'A result', note: 'Found by searching your name.' },
    { icon: 'identity', label: 'Is it you?', note: 'Unsure means we ask you, not guess.' },
    { icon: 'source', label: 'What is it?', note: 'Source, date, and what it actually says.' },
    { icon: 'document', label: 'In the report', note: 'With the excerpt it came from.' },
  ];

  return (
    <section className="wrap" style={{ paddingTop: 'var(--s-16)' }}>
      <h2 className="mark" style={{ fontSize: '1.5rem', marginBottom: 'var(--s-3)' }}>
        What happens to one result
      </h2>
      <p className="small" style={{ fontSize: '0.9375rem', maxWidth: '58ch', marginBottom: 'var(--s-8)' }}>
        Two of the four stops are exits. A result that is not about you leaves, and an
        adverse claim nobody has established does not become a finding on the way through.
      </p>

      <ol
        className="chain"
        style={{ listStyle: 'none' }}
      >
        {stops.map((s, i) => (
          <li key={s.label} className="chain-stop">
            <span className="chain-mark" aria-hidden>
              <Icon name={s.icon} scale={1.2} />
            </span>
            <h3 className="small" style={{ color: 'var(--text)', fontWeight: 650 }}>
              {s.label}
            </h3>
            <p className="small">{s.note}</p>
            {i < stops.length - 1 && (
              <span className="chain-link" aria-hidden>
                <Icon name="arrow-right" />
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="small" style={{ marginTop: 'var(--s-6)', maxWidth: '58ch' }}>
        <span style={{ color: 'var(--primary)' }}>
          <Icon name="alert" />
        </span>{' '}
        Anything adverse stops here and waits for a person to read the source. Until
        somebody has, it is not counted for or against you, and the report says so rather
        than reporting nothing.
      </p>
    </section>
  );
}

/**
 * The closing ask.
 *
 * One action, the same action as the hero, because a page with two
 * different next steps has decided neither of them matters. The line above
 * it is the honest version of a guarantee: not that the news will be good,
 * only that it will be checkable.
 */
function Closing() {
  return (
    <section className="wrap" style={{ paddingTop: 'var(--s-24)' }}>
      <div
        className="stack"
        style={{
          ['--gap' as string]: 'var(--s-6)',
          paddingTop: 'var(--s-12)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <h2 style={{ fontSize: 'clamp(1.6rem, 1.3rem + 1.4vw, 2.25rem)', maxWidth: '18ch' }}>
          It takes a name and about a minute.
        </h2>
        <p className="small" style={{ fontSize: '0.9375rem', maxWidth: '54ch' }}>
          We cannot promise the result is flattering. We can promise you will be able to see
          where every part of it came from, and that nothing is asserted about you that the
          evidence does not carry.
        </p>
        <div>
          <a href="/audit" className="btn btn-primary">
            Check My Reputation
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * The real report's figures, in a hero-sized frame.
 *
 * Not a screenshot and not the `Report` component itself: that is a client
 * component with a view toggle, and shipping the whole report's JavaScript
 * to a marketing page to render four numbers is the wrong trade. What
 * matters is that the numbers, the dimension labels and the risk sentence
 * all come out of the engine, so the page cannot describe a report the
 * product would not produce.
 *
 * Labelled as an example throughout, because rule 13 is not satisfied by
 * the data being obviously fake to somebody who already knows.
 */
function HeroPreview({ report }: { report: Awaited<ReturnType<typeof example>> }) {
  const { presence, risk } = report;
  if (presence.status !== 'scored') return null;

  const headline = riskHeadline(risk);

  /**
   * The three dimensions with a value, in the engine's own order.
   *
   * One of the five is `null` for this subject, because no website checks
   * ran: inapplicable rather than zero, which is rule 6 and is the thing
   * most competitors get wrong. It is left out of the preview rather than
   * shown as a gap, because three bars is a hero and five with a hole in it
   * is a conversation the hero does not have room for. The report itself
   * shows all five and says which is inapplicable.
   */
  const shown = presence.dimensions.filter((d) => d.value !== null).slice(0, 3);

  return (
    <div className="card glass" aria-label="Example of an audit report">
      <div
        className="row"
        style={{ justifyContent: 'space-between', marginBottom: 'var(--s-6)' }}
      >
        <p className="eyebrow">Example report</p>
        <span className="pill pill-neutral">Invented person</span>
      </div>

      <div
        className="row"
        style={{ alignItems: 'baseline', gap: 'var(--s-3)', marginBottom: 'var(--s-2)' }}
      >
        <span className="hero-figure" style={{ fontSize: '3.75rem' }}>
          {presence.score}
        </span>
        <span className="small">
          online presence
          <br />
          {Math.round(presence.coverage * 100)}% coverage
        </span>
      </div>

      <div
        className="stack"
        style={{ ['--gap' as string]: 'var(--s-4)', marginTop: 'var(--s-6)' }}
      >
        {shown.map((d) => (
          <div key={d.code} className="meter-row">
            <div className="row">
              <span className="small" style={{ color: 'var(--text)' }}>
                {DIMENSION_LABELS[d.code]}
              </span>
              <span className="meter-value">{Math.round((d.value as number) * 100)}</span>
            </div>
            <div className="meter">
              <span style={{ width: `${(d.value as number) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 'var(--s-8)',
          paddingTop: 'var(--s-6)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          className="row"
          style={{ justifyContent: 'space-between', marginBottom: 'var(--s-3)' }}
        >
          <span className="eyebrow">Reputation risk</span>
          <span className="pill pill-warning">{headline.label}</span>
        </div>
        <p className="small">{headline.support}</p>
      </div>
    </div>
  );
}
