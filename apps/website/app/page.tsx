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
export default function Home() {
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
                {[
                  'Every finding links to its source and the date we saw it.',
                  'Allegations are labelled as allegations, never as findings.',
                  'We tell you when the evidence is too thin to score.',
                ].map((line) => (
                  <li
                    key={line}
                    className="row"
                    style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}
                  >
                    <span
                      aria-hidden
                      style={{ color: 'var(--primary)', fontWeight: 700, lineHeight: 1.55 }}
                    >
                      ✓
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <HeroPreview />
          </div>
        </div>
      </section>

      <Steps />

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
  const steps = [
    {
      n: '01',
      title: 'Tell us who you are',
      body:
        'Name, profession, and whatever else distinguishes you: employer, city, credentials, your own site. Every detail is one more way to tell you apart from someone who shares your name.',
    },
    {
      n: '02',
      title: 'We search and read the results',
      body:
        'We run the searches a person would, then work through what comes back: what each result is, who published it, whether it is settled or merely alleged, and whether it is about you at all.',
    },
    {
      n: '03',
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
            <span className="step-number" aria-hidden>
              {s.n}
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
 * A static impression of the report, not a live one. Labelled as an example so
 * nobody mistakes a marketing illustration for their own data.
 */
function HeroPreview() {
  return (
    <div className="card" aria-label="Example of an audit report">
      <div
        className="row"
        style={{ justifyContent: 'space-between', marginBottom: 'var(--s-6)' }}
      >
        <p className="eyebrow">Example report</p>
        <span className="pill pill-neutral">Illustration</span>
      </div>

      <div
        className="row"
        style={{ alignItems: 'baseline', gap: 'var(--s-3)', marginBottom: 'var(--s-2)' }}
      >
        <span className="hero-figure" style={{ fontSize: '3.75rem' }}>
          71
        </span>
        <span className="small">
          online presence
          <br />
          88% coverage
        </span>
      </div>

      <div
        className="stack"
        style={{ ['--gap' as string]: 'var(--s-4)', marginTop: 'var(--s-6)' }}
      >
        {[
          ['Discoverability & ownership', 0.74],
          ['Profile completeness', 0.63],
          ['Source authority', 0.43],
        ].map(([label, v]) => (
          <div key={label as string} className="meter-row">
            <div className="row">
              <span className="small" style={{ color: 'var(--text)' }}>
                {label}
              </span>
              <span className="meter-value">{Math.round((v as number) * 100)}</span>
            </div>
            <div className="meter">
              <span style={{ width: `${(v as number) * 100}%` }} />
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
          <span className="pill pill-warning">Elevated</span>
        </div>
        <p className="small">
          One unsettled allegation, reported but not established. Shown separately so it
          cannot disappear into an average.
        </p>
      </div>
    </div>
  );
}
